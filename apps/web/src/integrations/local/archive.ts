import type { ContextboardDatabase, Todo } from "@contextboard/local-db";
import type {
	BoardItem,
	Card,
	CardReference,
	FileReference,
	LocalFile,
	TldrawDocument,
	Whiteboard,
} from "@contextboard/domain";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const ARCHIVE_FORMAT_VERSION = 1;
const TABLES = [
	"whiteboards",
	"cards",
	"boardItems",
	"tldrawDocuments",
	"files",
	"fileReferences",
	"cardReferences",
	"todos",
] as const;
type TableName = (typeof TABLES)[number];
type ArchiveManifest = {
	format: "contextboard";
	version: number;
	exportedAt: string;
	workspaceId: string;
	counts: Record<TableName, number>;
	checksums: Record<string, string>;
};

const encodeJson = (value: unknown) => strToU8(JSON.stringify(value));
const parseJsonLines = (bytes: Uint8Array) =>
	strFromU8(bytes)
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
const sha256 = async (bytes: Uint8Array) =>
	[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

export async function exportLocalArchive(
	db: ContextboardDatabase,
): Promise<Blob> {
	const workspaceId = String(
		(await db.settings.get("workspaceId"))?.value ?? "unknown",
	);
	const data: Record<TableName, unknown[]> = {
		whiteboards: await db.whiteboards.toArray(),
		cards: await db.cards.toArray(),
		boardItems: await db.boardItems.toArray(),
		tldrawDocuments: await db.tldrawDocuments.toArray(),
		files: [],
		fileReferences: await db.fileReferences.toArray(),
		cardReferences: await db.cardReferences.toArray(),
		todos: await db.todos.toArray(),
	};
	const files = await db.files.toArray();
	data.files = files.map(({ blob: _blob, ...metadata }) => metadata);
	const counts = Object.fromEntries(
		TABLES.map((table) => [table, data[table].length]),
	) as Record<TableName, number>;
	const entries: Record<string, Uint8Array> = {};
	for (const table of TABLES)
		entries[`data/${table}.json`] = encodeJson(data[table]);
	for (const file of files)
		entries[`blobs/${file.sha256}`] = new Uint8Array(
			await file.blob.arrayBuffer(),
		);
	const checksums = Object.fromEntries(
		await Promise.all(
			Object.entries(entries).map(async ([name, bytes]) => [
				name,
				await sha256(bytes),
			]),
		),
	);
	const manifest: ArchiveManifest = {
		format: "contextboard",
		version: ARCHIVE_FORMAT_VERSION,
		exportedAt: new Date().toISOString(),
		workspaceId,
		counts,
		checksums,
	};
	entries["manifest.json"] = encodeJson(manifest);
	return new Blob([zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>], {
		type: "application/zip",
	});
}

function normalizeConvex(
	table: TableName,
	row: Record<string, unknown>,
	deviceId: string,
) {
	const id = String(row._id ?? row.id);
	const createdAt = Number(row._creationTime ?? row.createdAt ?? Date.now());
	const common: Record<string, unknown> = {
		...row,
		id,
		createdAt,
		updatedAt: Number(row.updatedAt ?? createdAt),
		revision: Number(row.revision ?? 1),
		updatedByDeviceId: String(row.updatedByDeviceId ?? deviceId),
		deletedAt: row.deletedAt == null ? null : Number(row.deletedAt),
	};
	delete common._id;
	delete common._creationTime;
	if (table === "cards")
		return {
			...common,
			contentVersion: Number(row.contentVersion ?? row.version ?? 1),
			activePlacementCount: Number(row.activePlacementCount ?? 0),
			archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
		};
	if (table === "whiteboards")
		return {
			...common,
			parentWhiteboardId: row.parentWhiteboardId ?? null,
			ancestorIds: row.ancestorIds ?? [],
			depth: Number(row.depth ?? 0),
			sortKey: String(row.sortKey ?? id),
			pathKey: String(row.pathKey ?? id),
			cardCount: Number(row.cardCount ?? 0),
			childWhiteboardCount: Number(row.childWhiteboardCount ?? 0),
			archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
		};
	if (table === "boardItems")
		return {
			...common,
			archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
		};
	if (table === "tldrawDocuments")
		return {
			...common,
			documentVersion: Number(row.documentVersion ?? row.version ?? 1),
		};
	return common;
}

function findConvexTable(
	entries: Record<string, Uint8Array>,
	table: TableName,
) {
	const key = Object.keys(entries).find((name) =>
		name.replaceAll("\\", "/").endsWith(`${table}/documents.jsonl`),
	);
	return key ? parseJsonLines(entries[key]) : [];
}

function validate(data: Record<TableName, Record<string, unknown>[]>) {
	const cards = new Set(data.cards.map((row) => String(row.id)));
	const boards = new Set(data.whiteboards.map((row) => String(row.id)));
	for (const item of data.boardItems) {
		if (item.cardId && !cards.has(String(item.cardId)))
			throw new Error(`Board item ${item.id} references a missing card`);
		if (item.whiteboardId && !boards.has(String(item.whiteboardId)))
			throw new Error(`Board item ${item.id} references a missing whiteboard`);
		if (item.childWhiteboardId && !boards.has(String(item.childWhiteboardId)))
			throw new Error(
				`Board item ${item.id} references a missing child whiteboard`,
			);
	}
}

export async function importArchive(
	db: ContextboardDatabase,
	bytes: ArrayBuffer,
) {
	const entries = unzipSync(new Uint8Array(bytes));
	const deviceId = String(
		(await db.settings.get("deviceId"))?.value ?? crypto.randomUUID(),
	);
	const manifestBytes = entries["manifest.json"];
	const isNativeArchive = Boolean(manifestBytes);
	let workspaceId: string = crypto.randomUUID();
	const data = Object.fromEntries(
		TABLES.map((table) => [table, []]),
	) as unknown as Record<TableName, Record<string, unknown>[]>;
	if (manifestBytes) {
		const manifest = JSON.parse(strFromU8(manifestBytes)) as ArchiveManifest;
		if (
			manifest.format !== "contextboard" ||
			manifest.version !== ARCHIVE_FORMAT_VERSION
		)
			throw new Error(
				`Unsupported Contextboard archive version: ${manifest.version}`,
			);
		if (!manifest.checksums || typeof manifest.checksums !== "object")
			throw new Error("Archive checksums are missing");
		for (const [name, expected] of Object.entries(manifest.checksums)) {
			const entry = entries[name];
			if (!entry || (await sha256(entry)) !== expected)
				throw new Error(`Archive checksum mismatch for ${name}`);
		}
		workspaceId = manifest.workspaceId;
		for (const table of TABLES) {
			const tableBytes = entries[`data/${table}.json`];
			data[table] = tableBytes
				? (JSON.parse(strFromU8(tableBytes)) as Record<string, unknown>[])
				: [];
			if (data[table].length !== manifest.counts[table])
				throw new Error(`Archive count mismatch for ${table}`);
		}
	} else {
		for (const table of TABLES)
			data[table] = findConvexTable(entries, table).map((row) =>
				normalizeConvex(table, row, deviceId),
			);
		if (data.cards.length + data.whiteboards.length === 0)
			throw new Error(
				"This ZIP is neither a Contextboard archive nor a supported Convex export",
			);
	}
	validate(data);
	const fileRows = await Promise.all(
		data.files.map(async (row) => {
			const sha256 = String(row.sha256 ?? "");
			const storageId = String(row.storageId ?? "");
			const blobBytes =
				entries[`blobs/${sha256}`] ?? entries[`_storage/${storageId}`];
			if (!blobBytes && Number(row.refCount ?? 0) > 0)
				throw new Error(
					`Referenced image ${row.id} is missing from the archive`,
				);
			const blob = new Blob(
				blobBytes ? [blobBytes as Uint8Array<ArrayBuffer>] : [],
				{ type: String(row.contentType ?? "application/octet-stream") },
			);
			return {
				...row,
				sha256,
				blob,
				size: Number(row.size ?? blob.size),
				contentType: String(row.contentType ?? "application/octet-stream"),
				status: row.status === "pending_delete" ? "pending_delete" : "active",
				pendingDeleteAt:
					row.pendingDeleteAt == null ? null : Number(row.pendingDeleteAt),
			} as unknown as LocalFile;
		}),
	);
	if (!isNativeArchive && fileRows.length) {
		const urlMap = new Map<string, string>();
		for (let index = 0; index < fileRows.length; index += 1) {
			const oldUrl = String(data.files[index]?.url ?? "");
			if (oldUrl)
				urlMap.set(
					oldUrl,
					await new Promise<string>((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(String(reader.result));
						reader.onerror = () => reject(reader.error);
						reader.readAsDataURL(fileRows[index].blob);
					}),
				);
		}
		const rewrite = (value: unknown): unknown => {
			if (typeof value === "string") return urlMap.get(value) ?? value;
			if (Array.isArray(value)) return value.map(rewrite);
			if (!value || typeof value !== "object") return value;
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(([key, child]) => [
					key,
					rewrite(child),
				]),
			);
		};
		data.cards = data.cards.map((row) => ({
			...row,
			content: rewrite(row.content),
		}));
		data.tldrawDocuments = data.tldrawDocuments.map((row) => ({
			...row,
			snapshot: rewrite(row.snapshot),
		}));
	}
	await db.transaction(
		"rw",
		[
			db.whiteboards,
			db.cards,
			db.boardItems,
			db.tldrawDocuments,
			db.files,
			db.fileReferences,
			db.cardReferences,
			db.todos,
			db.changeLog,
			db.conflicts,
			db.syncPeers,
			db.settings,
		],
		async () => {
			await Promise.all([
				db.whiteboards.clear(),
				db.cards.clear(),
				db.boardItems.clear(),
				db.tldrawDocuments.clear(),
				db.files.clear(),
				db.fileReferences.clear(),
				db.cardReferences.clear(),
				db.todos.clear(),
				db.changeLog.clear(),
				db.conflicts.clear(),
				db.syncPeers.clear(),
			]);
			await db.whiteboards.bulkAdd(data.whiteboards as unknown as Whiteboard[]);
			await db.cards.bulkAdd(data.cards as unknown as Card[]);
			await db.boardItems.bulkAdd(data.boardItems as unknown as BoardItem[]);
			await db.tldrawDocuments.bulkAdd(
				data.tldrawDocuments as unknown as TldrawDocument[],
			);
			await db.files.bulkAdd(fileRows);
			await db.fileReferences.bulkAdd(
				data.fileReferences as unknown as FileReference[],
			);
			await db.cardReferences.bulkAdd(
				data.cardReferences as unknown as CardReference[],
			);
			await db.todos.bulkAdd(data.todos as unknown as Todo[]);
			await db.settings.bulkPut([
				{ key: "workspaceId", value: workspaceId },
				{ key: "deviceId", value: deviceId },
				{ key: "archiveFormatVersion", value: ARCHIVE_FORMAT_VERSION },
				{ key: "lastImportAt", value: Date.now() },
			]);
		},
	);
	return {
		workspaceId,
		counts: Object.fromEntries(
			TABLES.map((table) => [table, data[table].length]),
		),
	};
}
