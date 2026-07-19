import Dexie, { type EntityTable, type Table, type Transaction } from "dexie";
import type {
	BoardItem,
	Card,
	CardReference,
	FileReference,
	LocalFile,
	TldrawDocument,
	Whiteboard,
} from "@contextboard/domain";
import {
	HybridLogicalClock,
	SYNC_PROTOCOL_VERSION,
	type ChangeBatch,
	type ConflictRecord,
	type EntityChange,
} from "@contextboard/sync-protocol";

export type Setting = { key: string; value: unknown };
export type SyncPeer = {
	peerId: string;
	url: string;
	cursor: string | null;
	enabled: boolean;
	updatedAt: number;
};
export type Todo = {
	id: string;
	text: string;
	completed: boolean;
	revision: number;
	updatedAt: number;
	updatedByDeviceId: string;
	deletedAt: number | null;
	createdAt: number;
};

export class ContextboardDatabase extends Dexie {
	// Persistence accepts opaque imported identifiers at its boundary. Entity
	// records remain branded in the domain package, while lookups accept strings.
	whiteboards!: EntityTable<Whiteboard, any>;
	cards!: EntityTable<Card, any>;
	boardItems!: EntityTable<BoardItem, any>;
	tldrawDocuments!: EntityTable<TldrawDocument, any>;
	files!: EntityTable<LocalFile, any>;
	fileReferences!: EntityTable<FileReference, any>;
	cardReferences!: EntityTable<CardReference, any>;
	settings!: EntityTable<Setting, "key">;
	changeLog!: EntityTable<ChangeBatch, "changeId">;
	syncPeers!: EntityTable<SyncPeer, "peerId">;
	conflicts!: EntityTable<ConflictRecord, "conflictId">;
	todos!: EntityTable<Todo, "id">;

	constructor(name = "contextboard") {
		super(name);
		this.version(1).stores({
			whiteboards:
				"id, [parentWhiteboardId+archivedAt+sortKey], [archivedAt+pathKey], updatedAt, deletedAt",
			cards:
				"id, [archivedAt+updatedAt], [archivedAt+derivedTitle], [archivedAt+activePlacementCount+updatedAt], updatedAt, deletedAt",
			boardItems:
				"id, [whiteboardId+archivedAt+zIndex], [whiteboardId+shapeId], cardId, childWhiteboardId, deletedAt",
			tldrawDocuments: "id, &whiteboardId, updatedAt, deletedAt",
			files: "id, &sha256, status, pendingDeleteAt, deletedAt",
			fileReferences: "id, targetKey, [fileId+targetKey], fileId, deletedAt",
			cardReferences:
				"id, sourceCardId, targetCardId, [sourceCardId+targetCardId], deletedAt",
			settings: "key",
			changeLog: "changeId, [deviceId+sequence], createdAt",
			syncPeers: "peerId, enabled, updatedAt",
			conflicts: "conflictId, [entityType+entityId], createdAt, resolvedAt",
			todos: "id, completed, updatedAt, deletedAt",
		});
	}
}

export type CommandContext = {
	workspaceId: string;
	deviceId: string;
	clock: HybridLogicalClock;
};

export async function runLocalCommand<T>(
	db: ContextboardDatabase,
	context: CommandContext,
	command: string,
	tables: Table[],
	execute: (
		transaction: Transaction,
	) => Promise<{ result: T; changes: EntityChange[] }>,
): Promise<T> {
	return db.transaction(
		"rw",
		[...tables, db.changeLog, db.settings],
		async (transaction) => {
			const sequenceSetting = await db.settings.get("deviceSequence");
			const sequence =
				typeof sequenceSetting?.value === "number"
					? sequenceSetting.value + 1
					: 1;
			const { result, changes } = await execute(transaction);
			const now = Date.now();
			const batch: ChangeBatch = {
				protocolVersion: SYNC_PROTOCOL_VERSION,
				changeId: crypto.randomUUID(),
				workspaceId: context.workspaceId,
				deviceId: context.deviceId,
				sequence,
				clock: context.clock.tick(now),
				command,
				createdAt: now,
				changes,
			};
			await db.changeLog.add(batch);
			await db.settings.put({ key: "deviceSequence", value: sequence });
			return result;
		},
	);
}

export async function ensureLocalIdentity(db: ContextboardDatabase) {
	return db.transaction("rw", db.settings, async () => {
		const existingWorkspace = await db.settings.get("workspaceId");
		const existingDevice = await db.settings.get("deviceId");
		const workspaceId =
			typeof existingWorkspace?.value === "string"
				? existingWorkspace.value
				: crypto.randomUUID();
		const deviceId =
			typeof existingDevice?.value === "string"
				? existingDevice.value
				: crypto.randomUUID();
		await db.settings.bulkPut([
			{ key: "workspaceId", value: workspaceId },
			{ key: "deviceId", value: deviceId },
			{ key: "archiveFormatVersion", value: 1 },
		]);
		return { workspaceId, deviceId };
	});
}

export const createContextboardDatabase = (name?: string) =>
	new ContextboardDatabase(name);

export async function cleanupOrphanedFiles(
	db: ContextboardDatabase,
	now = Date.now(),
	graceMs = 24 * 60 * 60 * 1000,
) {
	const cutoff = now - graceMs;
	const candidates = await db.files
		.where("status")
		.equals("pending_delete")
		.toArray();
	let removed = 0;
	await db.transaction("rw", db.files, db.fileReferences, async () => {
		for (const file of candidates) {
			if ((file.pendingDeleteAt ?? now) > cutoff) continue;
			if (await db.fileReferences.where("fileId").equals(file.id).count())
				continue;
			await db.files.delete(file.id);
			removed += 1;
		}
	});
	return removed;
}
