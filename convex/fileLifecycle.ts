import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	extractCardImageRefs,
	extractTldrawImageRefs,
	normalizeCardImageFileIds,
	normalizeTldrawImageFileIds,
} from "./model/fileReferences";

const FILE_GC_DELAY_MS = 30_000;

type TargetType = "card" | "tldrawDocument";

type ResolvedRefs = {
	fileIds: Set<Id<"files">>;
	urlToFileId: Map<string, Id<"files">>;
};

export function getCardTargetKey(cardId: Id<"cards">) {
	return `card:${cardId}`;
}

export function getTldrawTargetKey(whiteboardId: Id<"whiteboards"> | null) {
	return `tldraw:${whiteboardId ?? "root"}`;
}

export async function ensureFileForStorageId(
	ctx: MutationCtx,
	storageId: Id<"_storage">,
) {
	const existing = await ctx.db
		.query("files")
		.withIndex("by_storageId", (q) => q.eq("storageId", storageId))
		.first();

	const metadata = await ctx.db.system.get("_storage", storageId);
	if (!metadata) {
		throw new Error("Uploaded file metadata not found");
	}

	const url = await ctx.storage.getUrl(storageId);
	if (!url) {
		throw new Error("Uploaded file URL not found");
	}

	const now = Date.now();
	if (existing) {
		await ctx.db.patch(existing._id, {
			url,
			kind: "image",
			contentType: metadata.contentType ?? undefined,
			size: metadata.size,
			sha256: metadata.sha256,
			updatedAt: now,
		});
		return {
			...(await ctx.db.get(existing._id))!,
			url,
		};
	}

	const fileId = await ctx.db.insert("files", {
		storageId,
		url,
		kind: "image",
		status: "active",
		refCount: 0,
		contentType: metadata.contentType ?? undefined,
		size: metadata.size,
		sha256: metadata.sha256,
		createdAt: now,
		updatedAt: now,
		pendingDeleteAt: null,
		deletedAt: null,
	});

	return (await ctx.db.get(fileId))!;
}

export async function prepareCardFileRefs(
	ctx: MutationCtx,
	content: unknown,
): Promise<{ content: unknown; fileIds: Set<Id<"files">> }> {
	const extracted = extractCardImageRefs(content);
	const resolved = await resolveExtractedRefs(ctx, extracted);
	const normalized = normalizeCardImageFileIds(content, resolved.urlToFileId);

	return {
		content: normalized.content,
		fileIds: resolved.fileIds,
	};
}

export async function prepareTldrawFileRefs(
	ctx: MutationCtx,
	snapshot: unknown,
): Promise<{ snapshot: unknown; fileIds: Set<Id<"files">> }> {
	const extracted = extractTldrawImageRefs(snapshot);
	const resolved = await resolveExtractedRefs(ctx, extracted);
	const normalized = normalizeTldrawImageFileIds(snapshot, resolved.urlToFileId);

	return {
		snapshot: normalized.snapshot,
		fileIds: resolved.fileIds,
	};
}

export async function reconcileCardFileRefs(
	ctx: MutationCtx,
	cardId: Id<"cards">,
	content: unknown,
) {
	const prepared = await prepareCardFileRefs(ctx, content);
	await reconcileTargetFileRefs(ctx, {
		targetKey: getCardTargetKey(cardId),
		targetType: "card",
		nextFileIds: prepared.fileIds,
	});
	return prepared.content;
}

export async function reconcileTldrawFileRefs(
	ctx: MutationCtx,
	whiteboardId: Id<"whiteboards"> | null,
	snapshot: unknown,
) {
	const prepared = await prepareTldrawFileRefs(ctx, snapshot);
	await reconcileTargetFileRefs(ctx, {
		targetKey: getTldrawTargetKey(whiteboardId),
		targetType: "tldrawDocument",
		nextFileIds: prepared.fileIds,
	});
	return prepared.snapshot;
}

export async function clearCardFileRefs(
	ctx: MutationCtx,
	cardId: Id<"cards">,
) {
	await clearTargetFileRefs(ctx, getCardTargetKey(cardId));
}

export async function clearTldrawFileRefs(
	ctx: MutationCtx,
	whiteboardId: Id<"whiteboards"> | null,
) {
	await clearTargetFileRefs(ctx, getTldrawTargetKey(whiteboardId));
}

export async function rebuildAllFileRefs(ctx: MutationCtx) {
	for await (const reference of ctx.db.query("fileReferences")) {
		await ctx.db.delete(reference._id);
	}

	for await (const file of ctx.db.query("files")) {
		if (file.status === "deleted") continue;
		await ctx.db.patch(file._id, {
			refCount: 0,
			status: "active",
			pendingDeleteAt: null,
			updatedAt: Date.now(),
		});
	}

	for await (const card of ctx.db.query("cards")) {
		if (card.archivedAt !== null) continue;

		const prepared = await prepareCardFileRefs(ctx, card.content);
		if (prepared.content !== card.content) {
			await ctx.db.patch(card._id, {
				content: prepared.content,
				updatedAt: Date.now(),
			});
		}
		await reconcileTargetFileRefs(ctx, {
			targetKey: getCardTargetKey(card._id),
			targetType: "card",
			nextFileIds: prepared.fileIds,
		});
	}

	const activeWhiteboardIds = new Set<Id<"whiteboards">>();
	for await (const whiteboard of ctx.db.query("whiteboards")) {
		if (whiteboard.archivedAt === null) {
			activeWhiteboardIds.add(whiteboard._id);
		}
	}

	for await (const document of ctx.db.query("tldrawDocuments")) {
		if (
			document.whiteboardId !== null &&
			!activeWhiteboardIds.has(document.whiteboardId)
		) {
			continue;
		}

		const prepared = await prepareTldrawFileRefs(ctx, document.snapshot);
		if (prepared.snapshot !== document.snapshot) {
			await ctx.db.patch(document._id, {
				snapshot: prepared.snapshot,
				updatedAt: Date.now(),
			});
		}
		await reconcileTargetFileRefs(ctx, {
			targetKey: getTldrawTargetKey(document.whiteboardId),
			targetType: "tldrawDocument",
			nextFileIds: prepared.fileIds,
		});
	}

	for await (const file of ctx.db.query("files")) {
		if (file.status === "deleted" || file.refCount > 0) continue;
		await markFilePendingDelete(ctx, file);
	}
}

export async function deletePendingFile(
	ctx: MutationCtx,
	fileId: Id<"files">,
) {
	const file = await ctx.db.get(fileId);
	if (!file) return;
	if (file.status !== "pending_delete" || file.refCount > 0) {
		return;
	}

	await ctx.storage.delete(file.storageId);
	await ctx.db.patch(file._id, {
		status: "deleted",
		deletedAt: Date.now(),
		pendingDeleteAt: null,
		updatedAt: Date.now(),
	});
}

async function resolveExtractedRefs(
	ctx: MutationCtx,
	extracted: {
		fileIds: Set<string>;
		legacyUrls: Set<string>;
	},
): Promise<ResolvedRefs> {
	const fileIds = new Set<Id<"files">>();
	const urlToFileId = new Map<string, Id<"files">>();

	for (const rawFileId of extracted.fileIds) {
		const fileId = ctx.db.normalizeId("files", rawFileId);
		if (!fileId) continue;
		const file = await ctx.db.get(fileId);
		if (!file || file.status === "deleted") continue;
		fileIds.add(fileId);
	}

	const unresolvedUrls = new Set<string>();
	for (const url of extracted.legacyUrls) {
		const existing = await ctx.db
			.query("files")
			.withIndex("by_url", (q) => q.eq("url", url))
			.first();
		if (existing && existing.status !== "deleted") {
			fileIds.add(existing._id);
			urlToFileId.set(url, existing._id);
			continue;
		}

		unresolvedUrls.add(url);
	}

	if (unresolvedUrls.size > 0) {
		const resolvedLegacyUrls = await resolveLegacyUrls(ctx, unresolvedUrls);
		for (const [url, fileId] of resolvedLegacyUrls) {
			fileIds.add(fileId);
			urlToFileId.set(url, fileId);
		}
	}

	return { fileIds, urlToFileId };
}

async function resolveLegacyUrls(
	ctx: MutationCtx,
	urls: Set<string>,
): Promise<Map<string, Id<"files">>> {
	const pending = new Set(urls);
	const urlToFileId = new Map<string, Id<"files">>();

	for await (const metadata of ctx.db.system.query("_storage")) {
		if (pending.size === 0) break;

		const url = await ctx.storage.getUrl(metadata._id);
		if (!url || !pending.has(url)) continue;

		const file = await ensureFileForStorageId(ctx, metadata._id);
		urlToFileId.set(url, file._id);
		pending.delete(url);
	}

	return urlToFileId;
}

async function reconcileTargetFileRefs(
	ctx: MutationCtx,
	args: {
		targetKey: string;
		targetType: TargetType;
		nextFileIds: Set<Id<"files">>;
	},
) {
	const existingRefs = new Map<Id<"files">, Doc<"fileReferences">>();
	for await (const reference of ctx.db
		.query("fileReferences")
		.withIndex("by_targetKey", (q) => q.eq("targetKey", args.targetKey))) {
		existingRefs.set(reference.fileId, reference);
	}

	for (const [fileId, reference] of existingRefs) {
		if (args.nextFileIds.has(fileId)) continue;
		await ctx.db.delete(reference._id);
		await decrementFileRefCount(ctx, fileId);
	}

	for (const fileId of args.nextFileIds) {
		if (existingRefs.has(fileId)) continue;

		await ctx.db.insert("fileReferences", {
			fileId,
			targetKey: args.targetKey,
			targetType: args.targetType,
			createdAt: Date.now(),
		});
		await incrementFileRefCount(ctx, fileId);
	}
}

async function clearTargetFileRefs(ctx: MutationCtx, targetKey: string) {
	const references: Doc<"fileReferences">[] = [];
	for await (const reference of ctx.db
		.query("fileReferences")
		.withIndex("by_targetKey", (q) => q.eq("targetKey", targetKey))) {
		references.push(reference);
	}

	for (const reference of references) {
		await ctx.db.delete(reference._id);
		await decrementFileRefCount(ctx, reference.fileId);
	}
}

async function incrementFileRefCount(ctx: MutationCtx, fileId: Id<"files">) {
	const file = await ctx.db.get(fileId);
	if (!file || file.status === "deleted") return;

	await ctx.db.patch(fileId, {
		refCount: file.refCount + 1,
		status: "active",
		pendingDeleteAt: null,
		updatedAt: Date.now(),
	});
}

async function decrementFileRefCount(ctx: MutationCtx, fileId: Id<"files">) {
	const file = await ctx.db.get(fileId);
	if (!file || file.status === "deleted") return;

	const nextRefCount = Math.max(0, file.refCount - 1);
	if (nextRefCount > 0) {
		await ctx.db.patch(fileId, {
			refCount: nextRefCount,
			updatedAt: Date.now(),
		});
		return;
	}

	await ctx.db.patch(fileId, {
		refCount: 0,
		updatedAt: Date.now(),
	});
	await markFilePendingDelete(ctx, file);
}

async function markFilePendingDelete(ctx: MutationCtx, file: Doc<"files">) {
	if (file.status === "deleted") return;

	await ctx.db.patch(file._id, {
		status: "pending_delete",
		pendingDeleteAt: Date.now() + FILE_GC_DELAY_MS,
		updatedAt: Date.now(),
	});
	await ctx.scheduler.runAfter(FILE_GC_DELAY_MS, internal.files.gcFile, {
		fileId: file._id,
	});
}
