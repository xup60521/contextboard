import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";

type WhiteboardPatch = {
	parentWhiteboardId?: Id<"whiteboards"> | null;
	ancestorIds?: Id<"whiteboards">[];
	depth?: number;
	sortKey?: string;
	pathKey?: string;
	cardCount?: number;
	childWhiteboardCount?: number;
	archivedAt?: number | null;
	updatedAt?: number;
};

type WhiteboardMetadata = {
	parentWhiteboardId: Id<"whiteboards"> | null;
	ancestorIds: Id<"whiteboards">[];
	depth: number;
	sortKey: string;
	pathKey: string;
};

export const normalizeLegacyWhiteboards = mutation({
	args: {},
	handler: async (ctx) => {
		const whiteboards: Doc<"whiteboards">[] = [];
		for await (const whiteboard of ctx.db.query("whiteboards")) {
			whiteboards.push(whiteboard);
		}

		const byId = new Map(whiteboards.map((whiteboard) => [whiteboard._id, whiteboard]));
		const metadataById = new Map<Id<"whiteboards">, WhiteboardMetadata>();

		const resolveMetadata = (
			whiteboardId: Id<"whiteboards">,
			seen = new Set<Id<"whiteboards">>(),
		): WhiteboardMetadata => {
			const existing = metadataById.get(whiteboardId);
			if (existing) return existing;

			const whiteboard = byId.get(whiteboardId);
			if (!whiteboard) {
				throw new Error(`Whiteboard ${whiteboardId} disappeared during migration`);
			}

			const sortKey =
				whiteboard.sortKey ??
				makeSortKey(whiteboard._creationTime, whiteboard._id);
			const parentWhiteboardId = resolveParentId(whiteboard);
			if (
				!parentWhiteboardId ||
				parentWhiteboardId === whiteboard._id ||
				!byId.has(parentWhiteboardId) ||
				seen.has(parentWhiteboardId)
			) {
				const rootLevelMetadata = {
					parentWhiteboardId: null,
					ancestorIds: [],
					depth: 0,
					sortKey,
					pathKey: sortKey,
				};
				metadataById.set(whiteboardId, rootLevelMetadata);
				return rootLevelMetadata;
			}

			const parentMetadata = resolveMetadata(
				parentWhiteboardId,
				new Set([...seen, whiteboardId]),
			);
			const metadata = {
				parentWhiteboardId,
				ancestorIds: [...parentMetadata.ancestorIds, parentWhiteboardId],
				depth: parentMetadata.depth + 1,
				sortKey,
				pathKey: `${parentMetadata.pathKey}/${sortKey}`,
			};
			metadataById.set(whiteboardId, metadata);
			return metadata;
		};

		for (const whiteboard of whiteboards) {
			resolveMetadata(whiteboard._id);
		}

		const childCounts = new Map<Id<"whiteboards">, number>();
		for (const metadata of metadataById.values()) {
			if (!metadata.parentWhiteboardId) continue;
			childCounts.set(
				metadata.parentWhiteboardId,
				(childCounts.get(metadata.parentWhiteboardId) ?? 0) + 1,
			);
		}

		const cardCounts = new Map<Id<"whiteboards">, number>();
		for await (const card of ctx.db.query("cards")) {
			if (!card.whiteboardId || card.archivedAt !== null) continue;
			cardCounts.set(card.whiteboardId, (cardCounts.get(card.whiteboardId) ?? 0) + 1);
		}

		let updated = 0;
		for (const whiteboard of whiteboards) {
			const metadata = metadataById.get(whiteboard._id);
			if (!metadata) continue;

			const patch: WhiteboardPatch = {};
			if (whiteboard.parentWhiteboardId !== metadata.parentWhiteboardId) {
				patch.parentWhiteboardId = metadata.parentWhiteboardId;
			}
			if (!idsEqual(whiteboard.ancestorIds ?? [], metadata.ancestorIds)) {
				patch.ancestorIds = metadata.ancestorIds;
			}
			if (whiteboard.depth !== metadata.depth) {
				patch.depth = metadata.depth;
			}
			if (whiteboard.sortKey !== metadata.sortKey) {
				patch.sortKey = metadata.sortKey;
			}
			if (whiteboard.pathKey !== metadata.pathKey) {
				patch.pathKey = metadata.pathKey;
			}
			const cardCount = cardCounts.get(whiteboard._id) ?? 0;
			if (whiteboard.cardCount !== cardCount) {
				patch.cardCount = cardCount;
			}
			const childWhiteboardCount = childCounts.get(whiteboard._id) ?? 0;
			if (whiteboard.childWhiteboardCount !== childWhiteboardCount) {
				patch.childWhiteboardCount = childWhiteboardCount;
			}
			if (whiteboard.archivedAt === undefined) {
				patch.archivedAt = null;
			}
			if (whiteboard.updatedAt === undefined) {
				patch.updatedAt = whiteboard._creationTime;
			}

			if (Object.keys(patch).length > 0) {
				await ctx.db.patch(whiteboard._id, patch);
				updated += 1;
			}
		}

		return { scanned: whiteboards.length, updated };

		function resolveParentId(whiteboard: (typeof whiteboards)[number]) {
			if (whiteboard.parentWhiteboardId !== undefined) {
				return whiteboard.parentWhiteboardId;
			}

			if (!whiteboard.parentId) return null;
			return ctx.db.normalizeId("whiteboards", whiteboard.parentId);
		}
	},
});

function makeSortKey(createdAt: number, id: Id<"whiteboards">) {
	return `${String(Math.floor(createdAt)).padStart(13, "0")}-${id}`;
}

function idsEqual(left: Id<"whiteboards">[], right: Id<"whiteboards">[]) {
	if (left.length !== right.length) return false;
	return left.every((id, index) => id === right[index]);
}
