import type {
	BoardItem,
	CanvasRecord,
	Card,
	CardContent,
	CardReference,
	CardRelation,
	FileReference,
	LocalFile,
	TldrawDocument,
	Whiteboard,
} from "@contextboard/domain";
import {
	type BlobDescriptor,
	type ChangeBatch,
	type ConflictRecord,
	conflictCopyCardId,
	deterministicEntityId,
	type EntityChange,
	type HybridLogicalClock,
	parseChangeBatch,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
	type SyncEntityType,
} from "@contextboard/sync-protocol";
import Dexie, { type EntityTable } from "dexie";

/**
 * The small table surface shared by the browser and headless SQLite stores.
 *
 * Dexie exposes a much larger API, but the local command/sync layer only needs
 * these operations. Queries intentionally return a tiny, backend-neutral
 * collection shape; the SQLite adapter implements indexed lookups by scanning
 * its compact replica tables, which is appropriate for a single agent box.
 */
export interface RowCollection<T> {
	first(): Promise<T | undefined>;
	toArray(): Promise<T[]>;
	count(): Promise<number>;
	limit(count: number): RowCollection<T>;
}

export interface RowWhereClause<T> {
	equals(value: any): RowCollection<T>;
}

export interface RowTable<T = any> {
	get(key: any): Promise<T | undefined>;
	bulkGet(keys: any[]): Promise<Array<T | undefined>>;
	put(value: T): Promise<any>;
	add(value: T): Promise<any>;
	bulkPut(values: T[]): Promise<any>;
	bulkAdd(values: T[]): Promise<any>;
	bulkDelete(keys: any[]): Promise<any>;
	delete(key: any): Promise<any>;
	update(key: any, changes: Partial<T>): Promise<any>;
	clear(): Promise<any>;
	toArray(): Promise<T[]>;
	count(): Promise<number>;
	where(index: string): RowWhereClause<T>;
	orderBy(index: string): RowCollection<T>;
}

export type LocalTransaction = unknown;

/** Platform-neutral database boundary used by commands, sync, and replicas. */
export interface ContextboardDatabaseLike {
	whiteboards: RowTable<Whiteboard>;
	cards: RowTable<Card>;
	cardContents: RowTable<CardContent>;
	boardItems: RowTable<BoardItem>;
	tldrawDocuments: RowTable<TldrawDocument>;
	files: RowTable<LocalFile>;
	fileReferences: RowTable<FileReference>;
	cardReferences: RowTable<CardReference>;
	cardRelations: RowTable<CardRelation>;
	canvasRecords: RowTable<CanvasRecord>;
	settings: RowTable<Setting>;
	changeLog: RowTable<ChangeBatch>;
	syncPeers: RowTable<SyncPeer>;
	conflicts: RowTable<ConflictRecord>;
	appliedChangeBatches: RowTable<AppliedChangeBatch>;
	todos: RowTable<Todo>;
	transaction(...args: any[]): Promise<any>;
}

export type ApplyRemoteResult = {
	applied: number;
	conflicts: number;
	materializedChanges?: EntityChange[];
};

export type Setting = { key: string; value: unknown };
export type SyncPeer = {
	peerId: string;
	url: string;
	cursor: string | null;
	enabled: boolean;
	updatedAt: number;
	lastSyncedAt: number | null;
};
export type AppliedChangeBatch = {
	changeId: string;
	workspaceId: string;
	deviceId: string;
	deviceSequence: number;
	appliedAt: number;
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
	cardContents!: EntityTable<CardContent, any>;
	boardItems!: EntityTable<BoardItem, any>;
	tldrawDocuments!: EntityTable<TldrawDocument, any>;
	files!: EntityTable<LocalFile, any>;
	fileReferences!: EntityTable<FileReference, any>;
	cardReferences!: EntityTable<CardReference, any>;
	cardRelations!: EntityTable<CardRelation, any>;
	canvasRecords!: EntityTable<CanvasRecord, any>;
	settings!: EntityTable<Setting, "key">;
	changeLog!: EntityTable<ChangeBatch, "changeId">;
	syncPeers!: EntityTable<SyncPeer, "peerId">;
	conflicts!: EntityTable<ConflictRecord, "conflictId">;
	appliedChangeBatches!: EntityTable<AppliedChangeBatch, "changeId">;
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
			changeLog: "changeId, &[workspaceId+deviceId+deviceSequence], createdAt",
			syncPeers: "peerId, enabled, updatedAt",
			conflicts: "conflictId, [entityType+entityId], createdAt, resolvedAt",
			todos: "id, completed, updatedAt, deletedAt",
		});
		this.version(2).stores({
			cardRelations:
				"id, whiteboardId, sourceCardId, targetCardId, [sourceCardId+targetCardId], deletedAt",
			canvasRecords:
				"id, &[whiteboardId+recordId], whiteboardId, recordType, clock, deletedAt",
			changeLog: "changeId, &[workspaceId+deviceId+deviceSequence], createdAt",
		});
		this.version(3).stores({
			syncPeers: "peerId, enabled, updatedAt",
			appliedChangeBatches:
				"changeId, &[workspaceId+deviceId+deviceSequence], appliedAt",
		});
		this.version(4).stores({
			cardRelations:
				"id, whiteboardId, sourceCardId, targetCardId, arrowShapeId, [sourceCardId+targetCardId], deletedAt",
		});
		this.version(5)
			.stores({
				cardContents:
					"id, &cardId, contentVersion, clock, updatedAt, deletedAt",
			})
			.upgrade(async (transaction) => {
				const cards = await transaction.table("cards").toArray();
				const contents = transaction.table("cardContents");
				for (const card of cards) {
					if (await contents.get(card.id)) continue;
					const updatedAt = Number(
						card.updatedAt ?? card.createdAt ?? Date.now(),
					);
					const deviceId = String(card.updatedByDeviceId ?? "migration");
					await contents.put({
						id: card.id,
						cardId: card.id,
						document: card.content ?? null,
						contentVersion: Number(card.contentVersion ?? 1),
						revision: Number(card.revision ?? 1),
						clock: `${String(updatedAt).padStart(13, "0")}:000000:${deviceId}`,
						createdAt: Number(card.createdAt ?? updatedAt),
						updatedAt,
						updatedByDeviceId: deviceId,
						deletedAt: card.deletedAt ?? null,
					});
				}
			});
		this.version(6).stores({
			whiteboards:
				"id, parentWhiteboardId, [parentWhiteboardId+archivedAt+sortKey], [archivedAt+pathKey], updatedAt, deletedAt",
			boardItems:
				"id, whiteboardId, [whiteboardId+archivedAt+zIndex], [whiteboardId+shapeId], cardId, childWhiteboardId, deletedAt",
			cardRelations:
				"id, whiteboardId, sourceCardId, targetCardId, arrowShapeId, [sourceCardId+targetCardId], deletedAt",
			canvasRecords:
				"id, &[whiteboardId+recordId], whiteboardId, recordType, clock, deletedAt",
			tldrawDocuments: "id, &whiteboardId, updatedAt, deletedAt",
			changeLog:
				"changeId, &[workspaceId+deviceId+deviceSequence], [createdAt+changeId], createdAt",
		});
		this.version(7)
			.stores({
				cardContents:
					"id, &cardId, contentVersion, clock, updatedAt, deletedAt",
			})
			.upgrade(async (transaction) => {
				const cards = await transaction.table("cards").toArray();
				const contents = transaction.table("cardContents");
				for (const card of cards) {
					if (card.content === null || card.content === undefined) continue;
					const existing = await contents.get(card.id);
					if (existing?.document !== null && existing?.document !== undefined) {
						continue;
					}
					const updatedAt = Number(
						card.updatedAt ?? card.createdAt ?? Date.now(),
					);
					const deviceId = String(card.updatedByDeviceId ?? "migration");
					await contents.put({
						...existing,
						id: card.id,
						cardId: card.id,
						document: card.content,
						contentVersion: Number(
							existing?.contentVersion ?? card.contentVersion ?? 1,
						),
						revision: Number(existing?.revision ?? card.revision ?? 1),
						clock: String(
							existing?.clock ??
								`${String(updatedAt).padStart(13, "0")}:000000:${deviceId}`,
						),
						createdAt: Number(
							existing?.createdAt ?? card.createdAt ?? updatedAt,
						),
						updatedAt: Number(existing?.updatedAt ?? updatedAt),
						updatedByDeviceId: String(existing?.updatedByDeviceId ?? deviceId),
						deletedAt: existing?.deletedAt ?? card.deletedAt ?? null,
					});
				}
			});
	}
}

export type CommandContext = {
	workspaceId: string;
	deviceId: string;
	clock: HybridLogicalClock;
};

export async function runLocalCommand<T>(
	db: ContextboardDatabaseLike,
	context: CommandContext,
	command: string,
	tables: RowTable[],
	execute: (
		transaction: LocalTransaction,
	) => Promise<{ result: T; changes: EntityChange[] }>,
): Promise<T> {
	const committed = await db.transaction(
		"rw",
		[...tables, db.changeLog, db.settings, db.appliedChangeBatches],
		async (transaction: LocalTransaction) => {
			const sequenceSetting = await db.settings.get("deviceSequence");
			const sequence =
				typeof sequenceSetting?.value === "number"
					? sequenceSetting.value + 1
					: 1;
			const { result, changes } = await execute(transaction);
			const now = Date.now();
			const batchClock = context.clock.tick(now);
			const batch: ChangeBatch = {
				protocolVersion: SYNC_PROTOCOL_VERSION,
				schemaVersion: SYNC_SCHEMA_VERSION,
				changeId: crypto.randomUUID(),
				workspaceId: context.workspaceId,
				deviceId: context.deviceId,
				deviceSequence: sequence,
				clock: batchClock,
				command,
				createdAt: now,
				changes: changes.map((change) => ({
					...change,
					clock: change.clock || batchClock,
				})),
			};
			await db.changeLog.add(batch);
			await db.appliedChangeBatches.put({
				changeId: batch.changeId,
				workspaceId: batch.workspaceId,
				deviceId: batch.deviceId,
				deviceSequence: batch.deviceSequence,
				appliedAt: now,
			});
			await db.settings.put({ key: "deviceSequence", value: sequence });
			const checkpointCount = await db.settings.get("checkpointChangeCount");
			const checkpointBytes = await db.settings.get("checkpointChangeBytes");
			const nextCheckpointCount =
				(typeof checkpointCount?.value === "number"
					? checkpointCount.value
					: 0) + 1;
			const nextCheckpointBytes =
				(typeof checkpointBytes?.value === "number"
					? checkpointBytes.value
					: 0) + new TextEncoder().encode(JSON.stringify(batch)).byteLength;
			await db.settings.bulkPut([
				{
					key: "checkpointChangeCount",
					value: nextCheckpointCount,
				},
				{
					key: "checkpointChangeBytes",
					value: nextCheckpointBytes,
				},
			]);
			return {
				result,
				shouldCompact:
					nextCheckpointCount >= UNPEERED_COMPACTION_BATCHES ||
					nextCheckpointBytes >= UNPEERED_COMPACTION_BYTES,
			};
		},
	);
	// A local-only workspace has nobody to acknowledge its append-only log.
	// Periodically collapse it to one materialized post-state batch so autosave
	// cost stays bounded for users who remain offline indefinitely. This is
	// best-effort maintenance after the command commits: a compaction failure
	// must never make callers retry an already-committed domain write.
	if (committed.shouldCompact)
		await compactUnpeeredPendingBatches(db).catch(() => undefined);
	return committed.result;
}

const UNPEERED_COMPACTION_BATCHES = 1_000;
const UNPEERED_COMPACTION_BYTES = 10 * 1024 * 1024;

async function compactUnpeeredPendingBatches(db: ContextboardDatabaseLike) {
	const peers = await db.syncPeers.toArray();
	if (peers.some((peer) => peer.enabled)) return;
	await rebuildPendingBatches(db, {
		command: "maintenance.compactPendingChanges",
		requireLegacy: false,
		markFormatCurrent: false,
	});
}

/** Keeps the active Dexie transaction alive while a browser API promise settles. */
export function waitForExternal<T>(promise: PromiseLike<T>): Promise<T> {
	return Dexie.waitFor(promise);
}

export async function ensureLocalIdentity(db: ContextboardDatabaseLike) {
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
	db: ContextboardDatabaseLike,
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

export async function getPendingBatches(
	db: ContextboardDatabaseLike,
	limit: number,
) {
	const boundedLimit = Math.max(1, limit);
	const format = await db.settings.get("changeLogFormatVersion");
	if (format?.value === 2)
		return db.changeLog.orderBy("createdAt").limit(boundedLimit).toArray();

	// Pre-versioned databases need one compatibility scan. Once recorded, the
	// hot polling path never materializes more rows than the requested limit.
	const pending = await db.changeLog.orderBy("createdAt").toArray();
	const hasLegacyBatch = pending.some((batch) => {
		try {
			parseChangeBatch(batch);
			return false;
		} catch {
			return true;
		}
	});
	const current = hasLegacyBatch
		? await rebuildLegacyPendingBatches(db)
		: pending;
	// The rebuilding transaction records this marker itself. Keep the simple
	// no-legacy upgrade cheap while ensuring a failed rebuild can never leave a
	// partially migrated log marked current.
	if (!hasLegacyBatch)
		await db.settings.put({ key: "changeLogFormatVersion", value: 2 });
	return current.slice(0, boundedLimit);
}

/**
 * The pre-sync prototype logged mutation arguments and used `sequence` instead
 * of the versioned ChangeBatch contract. Those batches cannot be transported
 * safely. Rebuild one post-state batch from the local materialized truth so no
 * offline user data is discarded.
 */
async function rebuildLegacyPendingBatches(
	db: ContextboardDatabaseLike,
): Promise<ChangeBatch[]> {
	return rebuildPendingBatches(db, {
		command: "migration.rebuildPendingChanges",
		requireLegacy: true,
		markFormatCurrent: true,
	});
}

async function rebuildPendingBatches(
	db: ContextboardDatabaseLike,
	options: {
		command: string;
		requireLegacy: boolean;
		markFormatCurrent: boolean;
	},
): Promise<ChangeBatch[]> {
	const transactionTables = [
		db.whiteboards,
		db.cards,
		db.cardContents,
		db.boardItems,
		db.tldrawDocuments,
		db.files,
		db.fileReferences,
		db.cardReferences,
		db.cardRelations,
		db.canvasRecords,
		db.conflicts,
		db.todos,
		db.changeLog,
		db.appliedChangeBatches,
		db.settings,
	];
	return db.transaction("rw", transactionTables, async () => {
		const pending = await db.changeLog.orderBy("createdAt").toArray();
		const stillHasLegacy = pending.some((batch) => {
			try {
				parseChangeBatch(batch);
				return false;
			} catch {
				return true;
			}
		});
		if (options.requireLegacy && !stillHasLegacy) {
			if (options.markFormatCurrent)
				await db.settings.put({ key: "changeLogFormatVersion", value: 2 });
			return pending;
		}

		const workspaceId = (await db.settings.get("workspaceId"))?.value;
		const deviceId = (await db.settings.get("deviceId"))?.value;
		if (typeof workspaceId !== "string" || typeof deviceId !== "string")
			throw new Error("Local workspace identity is unavailable");

		const now = Date.now();
		const sequenceSetting = await db.settings.get("deviceSequence");
		const appliedSequences = (await db.appliedChangeBatches.toArray())
			.filter(
				(batch) =>
					batch.workspaceId === workspaceId && batch.deviceId === deviceId,
			)
			.map((batch) => batch.deviceSequence);
		const pendingSequences = pending
			.filter(
				(batch) =>
					batch.workspaceId === workspaceId && batch.deviceId === deviceId,
			)
			.flatMap((batch) => {
				const legacy = batch as ChangeBatch & { sequence?: unknown };
				const value =
					typeof batch.deviceSequence === "number"
						? batch.deviceSequence
						: legacy.sequence;
				return typeof value === "number" && Number.isSafeInteger(value)
					? [value]
					: [];
			});
		const deviceSequence =
			Math.max(
				0,
				typeof sequenceSetting?.value === "number" ? sequenceSetting.value : 0,
				...appliedSequences,
				...pendingSequences,
			) + 1;
		const clock = `${String(now).padStart(13, "0")}:000000:${deviceId}`;

		// Preserve legacy non-managed tldraw records without ever putting the
		// full snapshot into the outgoing batch.
		for (const document of await db.tldrawDocuments.toArray()) {
			if (typeof document.whiteboardId !== "string") continue;
			const snapshot = document.snapshot as
				| { store?: Record<string, unknown> }
				| undefined;
			for (const payload of Object.values(snapshot?.store ?? {})) {
				if (!payload || typeof payload !== "object") continue;
				const record = payload as {
					id?: unknown;
					type?: unknown;
					typeName?: unknown;
				};
				if (
					typeof record.id !== "string" ||
					record.type === "markdown-card" ||
					record.type === "subwhiteboard-link"
				)
					continue;
				const existing = await db.canvasRecords
					.where("[whiteboardId+recordId]")
					.equals([document.whiteboardId, record.id])
					.first();
				if (existing) continue;
				await db.canvasRecords.add({
					id: `${document.whiteboardId}:${record.id}` as never,
					whiteboardId: document.whiteboardId,
					recordId: record.id,
					recordType: String(record.typeName ?? record.type ?? "unknown"),
					payload,
					clock,
					revision: 1,
					createdAt: document.createdAt,
					updatedAt: document.updatedAt,
					updatedByDeviceId: deviceId,
					deletedAt: null,
				});
			}
		}

		const sources: Array<[SyncEntityType, RowTable]> = [
			["whiteboard", db.whiteboards],
			["card", db.cards],
			["cardContent", db.cardContents],
			["boardItem", db.boardItems],
			["file", db.files],
			["fileReference", db.fileReferences],
			["cardReference", db.cardReferences],
			["cardRelation", db.cardRelations],
			["canvasRecord", db.canvasRecords],
			["conflict", db.conflicts],
			["todo", db.todos],
		];
		const changes: EntityChange[] = [];
		for (const [entityType, table] of sources) {
			for (const value of (await table.toArray()) as Array<
				Record<string, unknown>
			>) {
				const id = String(value.id ?? value.conflictId ?? "");
				if (!id) continue;
				const revision = Math.max(1, Number(value.revision ?? 1));
				const serialized =
					entityType === "file"
						? (() => {
								const { blob: _blob, sha256, ...descriptor } = value;
								return { ...descriptor, hash: sha256 };
							})()
						: value;
				changes.push({
					entityType,
					entityId: id,
					baseRevision: null,
					revision,
					operation: value.deletedAt ? "delete" : "upsert",
					clock:
						typeof value.clock === "string" && value.clock
							? value.clock
							: clock,
					value: serialized,
				});
			}
		}

		const rebuilt: ChangeBatch = {
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId: crypto.randomUUID(),
			workspaceId,
			deviceId,
			deviceSequence,
			clock,
			command: options.command,
			createdAt: now,
			changes,
		};
		await db.appliedChangeBatches.bulkDelete(
			pending.map((batch) => batch.changeId),
		);
		await db.changeLog.clear();
		await db.changeLog.add(rebuilt);
		await db.appliedChangeBatches.put({
			changeId: rebuilt.changeId,
			workspaceId,
			deviceId,
			deviceSequence,
			appliedAt: now,
		});
		await db.settings.bulkPut([
			{ key: "deviceSequence", value: deviceSequence },
			{ key: "checkpointChangeCount", value: 1 },
			{
				key: "checkpointChangeBytes",
				value: new TextEncoder().encode(JSON.stringify(rebuilt)).byteLength,
			},
			...(options.markFormatCurrent
				? [{ key: "changeLogFormatVersion", value: 2 }]
				: []),
		]);
		return [rebuilt];
	});
}

export async function acknowledgeBatches(
	db: ContextboardDatabaseLike,
	changeIds: string[],
) {
	await db.changeLog.bulkDelete(changeIds);
}

const remoteTable = (
	db: ContextboardDatabaseLike,
	entityType: string,
): RowTable | null =>
	entityType === "whiteboard"
		? db.whiteboards
		: entityType === "card"
			? db.cards
			: entityType === "cardContent"
				? db.cardContents
				: entityType === "boardItem"
					? db.boardItems
					: entityType === "tldrawDocument"
						? db.tldrawDocuments
						: entityType === "file"
							? db.files
							: entityType === "fileReference"
								? db.fileReferences
								: entityType === "cardReference"
									? db.cardReferences
									: entityType === "cardRelation"
										? db.cardRelations
										: entityType === "canvasRecord"
											? db.canvasRecords
											: entityType === "conflict"
												? db.conflicts
												: entityType === "todo"
													? db.todos
													: null;

/** Applies server batches without creating a new local batch. */
export async function applyRemoteBatches(
	db: ContextboardDatabaseLike,
	batches: ChangeBatch[],
	peerId = "contextboard-cloud",
	nextCursor?: string,
): Promise<ApplyRemoteResult> {
	let applied = 0;
	let conflicts = 0;
	const materializedChanges: EntityChange[] = [];
	if (batches.length === 0) {
		if (nextCursor !== undefined)
			await updateSyncCursor(db, peerId, nextCursor);
		return { applied, conflicts, materializedChanges };
	}
	for (let offset = 0; offset < batches.length; offset += 25) {
		const chunk = batches.slice(offset, offset + 25);
		const result = await applyRemoteBatchChunk(
			db,
			chunk,
			peerId,
			offset + chunk.length >= batches.length ? nextCursor : undefined,
		);
		applied += result.applied;
		conflicts += result.conflicts;
		materializedChanges.push(...(result.materializedChanges ?? []));
	}
	return { applied, conflicts, materializedChanges };
}

async function applyRemoteBatchChunk(
	db: ContextboardDatabaseLike,
	batches: ChangeBatch[],
	peerId: string,
	nextCursor?: string,
): Promise<ApplyRemoteResult> {
	let applied = 0;
	let conflicts = 0;
	const materializedChanges: EntityChange[] = [];
	const tables = [
		db.whiteboards,
		db.cards,
		db.cardContents,
		db.boardItems,
		db.tldrawDocuments,
		db.files,
		db.fileReferences,
		db.cardReferences,
		db.cardRelations,
		db.canvasRecords,
		db.todos,
		db.conflicts,
		db.appliedChangeBatches,
		db.syncPeers,
		db.settings,
	];
	await db.transaction("rw", tables, async () => {
		let newlyAppliedBatches = 0;
		let newlyAppliedBytes = 0;
		const affectedWhiteboardIds = new Set<string>();
		for (const batch of batches) {
			if (await db.appliedChangeBatches.get(batch.changeId)) continue;
			newlyAppliedBatches++;
			newlyAppliedBytes += new TextEncoder().encode(
				JSON.stringify(batch),
			).byteLength;
			const conflictCopyByCardId = new Map<string, string>();
			for (const change of batch.changes) {
				const table = remoteTable(db, change.entityType);
				if (!table || !change.value || typeof change.value !== "object")
					continue;
				const incoming = change.value as Record<string, unknown>;
				let materialized =
					change.entityType === "file"
						? {
								...incoming,
								sha256: String(incoming.hash ?? incoming.sha256 ?? ""),
								blob: null,
							}
						: change.entityType === "cardRelation" ||
								change.entityType === "canvasRecord"
							? { ...incoming, clock: change.clock }
							: incoming;
				const redirectedEntityId =
					change.entityType === "cardContent"
						? conflictCopyByCardId.get(change.entityId)
						: undefined;
				if (redirectedEntityId)
					materialized = {
						...materialized,
						id: redirectedEntityId,
						cardId: redirectedEntityId,
					};
				const targetEntityId = redirectedEntityId ?? change.entityId;
				const local = (await table.get(targetEntityId)) as
					| Record<string, unknown>
					| undefined;
				if (change.entityType === "whiteboard") {
					const parentId = (materialized.parentWhiteboardId ?? null) as never;
					const invalid = await hasInvalidStoredHierarchy(
						db,
						change.entityId,
						parentId,
					);
					if (invalid) {
						const conflictId = `hierarchy:${change.entityId}:${String(parentId ?? "root")}:${change.clock}`;
						if (!(await db.conflicts.get(conflictId))) {
							await db.conflicts.add({
								conflictId,
								entityType: "whiteboard",
								entityId: change.entityId,
								localValue: local ?? null,
								remoteValue: incoming,
								createdAt: batch.createdAt,
								resolvedAt: null,
								resolution: null,
								revision: 1,
								updatedAt: batch.createdAt,
								updatedByDeviceId: batch.deviceId,
							});
							conflicts++;
							materializedChanges.push({
								...change,
								entityType: "conflict",
								entityId: conflictId,
							});
						}
						continue;
					}
				}
				if (
					change.entityType === "card" &&
					local &&
					batch.command !== "conflicts.resolve" &&
					change.baseRevision !== Number(local.revision)
				) {
					const participants = [
						`${String(local.updatedByDeviceId ?? "")}:${String(local.revision ?? 0)}`,
						`${batch.deviceId}:${change.revision}`,
					].sort();
					const conflictId = `conflict:${change.entityId}:${participants.join(":")}`;
					const conflictCardId = conflictCopyCardId(conflictId);
					conflictCopyByCardId.set(change.entityId, conflictCardId);
					if (!(await db.conflicts.get(conflictId))) {
						const placements = (
							await db.boardItems
								.where("cardId")
								.equals(change.entityId)
								.toArray()
						).filter(
							(placement) =>
								placement.deletedAt === null && placement.archivedAt === null,
						);
						await db.cards.put({
							...materialized,
							id: conflictCardId,
							derivedTitle: `Conflict: ${String(incoming.derivedTitle ?? "Untitled card")}`,
							activePlacementCount: placements.length,
						} as never);
						if ("content" in materialized) {
							await db.cardContents.put(
								legacyCardContentRow(
									materialized,
									conflictCardId,
									change.clock,
									batch.deviceId,
								),
							);
						}
						for (const [index, placement] of placements.entries()) {
							await db.boardItems.put({
								...placement,
								id: deterministicEntityId(
									"conflict-placement",
									conflictId,
									placement.id,
								),
								cardId: conflictCardId,
								shapeId: deterministicEntityId(
									"conflict-shape",
									conflictId,
									placement.shapeId,
								),
								x: placement.x + 48 * (index + 1),
								y: placement.y + 48 * (index + 1),
							} as never);
							if (placement.whiteboardId)
								affectedWhiteboardIds.add(placement.whiteboardId);
						}
						for (const reference of await db.cardReferences
							.where("sourceCardId")
							.equals(change.entityId)
							.toArray())
							await db.cardReferences.put({
								...reference,
								id: deterministicEntityId(
									"conflict-reference",
									conflictId,
									reference.id,
								),
								sourceCardId: conflictCardId,
							} as never);
						for (const reference of await db.fileReferences
							.where("targetKey")
							.equals(`card:${change.entityId}`)
							.toArray())
							await db.fileReferences.put({
								...reference,
								id: deterministicEntityId(
									"conflict-file-reference",
									conflictId,
									reference.id,
								),
								targetKey: `card:${conflictCardId}`,
							} as never);
						await db.conflicts.add({
							conflictId,
							entityType: "card",
							entityId: change.entityId,
							localValue: local,
							remoteValue: incoming,
							createdAt: batch.createdAt,
							resolvedAt: null,
							resolution: null,
							revision: 1,
							updatedAt: batch.createdAt,
							updatedByDeviceId: batch.deviceId,
						});
						conflicts++;
						materializedChanges.push(
							{
								...change,
								entityType: "conflict",
								entityId: conflictId,
							},
							{ ...change, entityId: conflictCardId },
						);
					}
					continue;
				}
				if (
					(change.entityType === "canvasRecord" ||
						change.entityType === "cardRelation") &&
					local
				) {
					const localClock = String(local.clock ?? "");
					if (
						localClock > change.clock ||
						(localClock === change.clock &&
							String(local.updatedByDeviceId ?? "") >= batch.deviceId)
					)
						continue;
				}
				if (change.entityType === "whiteboard") {
					affectedWhiteboardIds.add(change.entityId);
					const previousParent = local?.parentWhiteboardId;
					const nextParent = materialized.parentWhiteboardId;
					if (typeof previousParent === "string")
						affectedWhiteboardIds.add(previousParent);
					if (typeof nextParent === "string")
						affectedWhiteboardIds.add(nextParent);
				}
				if (change.entityType === "boardItem") {
					const previousBoard = local?.whiteboardId;
					const nextBoard = materialized.whiteboardId;
					if (typeof previousBoard === "string")
						affectedWhiteboardIds.add(previousBoard);
					if (typeof nextBoard === "string")
						affectedWhiteboardIds.add(nextBoard);
				}
				await table.put(materialized);
				applied++;
				materializedChanges.push(
					targetEntityId === change.entityId
						? change
						: { ...change, entityId: targetEntityId },
				);
				if (change.entityType === "card" && "content" in materialized) {
					const existingContent = await db.cardContents.get(targetEntityId);
					if (!existingContent || existingContent.clock < change.clock) {
						const contentRow = legacyCardContentRow(
							materialized,
							targetEntityId,
							change.clock,
							batch.deviceId,
						);
						await db.cardContents.put(contentRow);
						materializedChanges.push({
							...change,
							entityType: "cardContent",
							entityId: targetEntityId,
							value: contentRow,
						});
					}
				}
			}
			await db.appliedChangeBatches.put({
				changeId: batch.changeId,
				workspaceId: batch.workspaceId,
				deviceId: batch.deviceId,
				deviceSequence: batch.deviceSequence,
				appliedAt: Date.now(),
			});
		}
		if (nextCursor !== undefined)
			await db.syncPeers.put({
				peerId,
				url: "",
				cursor: nextCursor,
				enabled: true,
				updatedAt: Date.now(),
				lastSyncedAt: Date.now(),
			});
		if (newlyAppliedBatches) {
			const count = await db.settings.get("checkpointChangeCount");
			const bytes = await db.settings.get("checkpointChangeBytes");
			await db.settings.bulkPut([
				{
					key: "checkpointChangeCount",
					value:
						(typeof count?.value === "number" ? count.value : 0) +
						newlyAppliedBatches,
				},
				{
					key: "checkpointChangeBytes",
					value:
						(typeof bytes?.value === "number" ? bytes.value : 0) +
						newlyAppliedBytes,
				},
			]);
		}
		// Counts are derived from active items and child whiteboards at read time.
	});
	return { applied, conflicts, materializedChanges };
}

function legacyCardContentRow(
	card: Record<string, unknown>,
	cardId: string,
	clock: string,
	deviceId: string,
): CardContent {
	return {
		id: cardId as CardContent["id"],
		cardId: cardId as CardContent["cardId"],
		document: card.content ?? { type: "doc", content: [] },
		contentVersion: Number(card.contentVersion ?? 1),
		revision: Number(card.revision ?? 1),
		clock,
		createdAt: Number(card.createdAt ?? Date.now()),
		updatedAt: Number(card.updatedAt ?? Date.now()),
		updatedByDeviceId: String(card.updatedByDeviceId ?? deviceId),
		deletedAt: typeof card.deletedAt === "number" ? card.deletedAt : null,
	};
}

async function hasInvalidStoredHierarchy(
	db: ContextboardDatabaseLike,
	whiteboardId: string,
	parentId: string | null,
) {
	const seen = new Set([whiteboardId]);
	let cursor = parentId;
	while (cursor !== null) {
		if (seen.has(cursor)) return true;
		seen.add(cursor);
		const parent = await db.whiteboards.get(cursor as never);
		if (!parent || parent.deletedAt !== null) return true;
		cursor = parent.parentWhiteboardId as string | null;
	}
	return false;
}

export async function getSyncState(
	db: ContextboardDatabaseLike,
	peerId = "contextboard-cloud",
) {
	const existing = await db.syncPeers.get(peerId);
	return (
		existing ?? {
			peerId,
			url: "",
			cursor: null,
			enabled: true,
			updatedAt: Date.now(),
			lastSyncedAt: null,
		}
	);
}

export async function updateSyncCursor(
	db: ContextboardDatabaseLike,
	peerId: string,
	cursor: string,
) {
	const existing = await db.syncPeers.get(peerId);
	const now = Date.now();
	await db.syncPeers.put({
		peerId,
		url: existing?.url ?? "",
		cursor,
		enabled: existing?.enabled ?? true,
		updatedAt: now,
		lastSyncedAt: now,
	});
}

export async function hasWorkspaceData(db: ContextboardDatabaseLike) {
	const counts = await Promise.all([
		db.whiteboards.count(),
		db.cards.count(),
		db.cardContents.count(),
		db.boardItems.count(),
		db.canvasRecords.count(),
		db.fileReferences.count(),
		db.files.count(),
		db.cardReferences.count(),
		db.cardRelations.count(),
		db.tldrawDocuments.count(),
		db.todos.count(),
		db.conflicts.count(),
	]);
	return counts.some((count) => count > 0);
}

export async function adoptWorkspaceId(
	db: ContextboardDatabaseLike,
	workspaceId: string,
) {
	if (await hasWorkspaceData(db))
		throw new Error("A non-empty local workspace cannot be replaced");
	await db.settings.put({ key: "workspaceId", value: workspaceId });
}

/**
 * Rebinds a non-empty local workspace after the server has explicitly merged
 * its remote workspace into another one. This is intentionally separate from
 * adoptWorkspaceId so ordinary workspace selection cannot silently rename
 * local data.
 */
export async function rebindWorkspaceId(
	db: ContextboardDatabaseLike,
	fromWorkspaceId: string,
	toWorkspaceId: string,
) {
	if (!fromWorkspaceId || !toWorkspaceId || fromWorkspaceId === toWorkspaceId)
		throw new Error("Workspace rebind requires two different workspace IDs");
	await db.transaction(
		"rw",
		[db.settings, db.changeLog, db.appliedChangeBatches, db.syncPeers],
		async () => {
			const [batches, applied, peer] = await Promise.all([
				db.changeLog.toArray(),
				db.appliedChangeBatches.toArray(),
				db.syncPeers.get("contextboard-cloud"),
			]);
			await db.changeLog.bulkPut(
				batches.map((batch) =>
					batch.workspaceId === fromWorkspaceId
						? { ...batch, workspaceId: toWorkspaceId }
						: batch,
				),
			);
			await db.appliedChangeBatches.bulkPut(
				applied.map((batch) =>
					batch.workspaceId === fromWorkspaceId
						? { ...batch, workspaceId: toWorkspaceId }
						: batch,
				),
			);
			await db.settings.put({ key: "workspaceId", value: toWorkspaceId });
			if (peer)
				await db.syncPeers.put({
					...peer,
					cursor: null,
					lastSyncedAt: null,
					updatedAt: Date.now(),
				});
		},
	);
}

export async function getLocalBlob(db: ContextboardDatabaseLike, hash: string) {
	const file = await db.files.where("sha256").equals(hash).first();
	if (!file?.blob) return null;
	return {
		descriptor: {
			hash: file.sha256,
			contentType: file.contentType,
			size: file.size,
		},
		blob: file.blob,
	};
}

export async function storeRemoteBlob(
	db: ContextboardDatabaseLike,
	descriptor: BlobDescriptor,
	blob: Blob,
) {
	const file = await db.files.where("sha256").equals(descriptor.hash).first();
	if (!file) throw new Error(`Missing file metadata for ${descriptor.hash}`);
	await db.files.update(file.id, {
		blob,
		contentType: descriptor.contentType,
		size: descriptor.size,
	});
}

export async function getMissingBlobs(db: ContextboardDatabaseLike) {
	return (await db.files.toArray())
		.filter((file) => file.blob === null && file.deletedAt === null)
		.map((file) => ({
			hash: file.sha256,
			contentType: file.contentType,
			size: file.size,
		}));
}

export async function exportCheckpointEntities(db: ContextboardDatabaseLike) {
	const [
		whiteboards,
		cards,
		cardContents,
		boardItems,
		files,
		fileReferences,
		cardReferences,
		cardRelations,
		canvasRecords,
		todos,
		conflicts,
	] = await Promise.all([
		db.whiteboards.toArray(),
		db.cards.toArray(),
		db.cardContents.toArray(),
		db.boardItems.toArray(),
		db.files.toArray(),
		db.fileReferences.toArray(),
		db.cardReferences.toArray(),
		db.cardRelations.toArray(),
		db.canvasRecords.toArray(),
		db.todos.toArray(),
		db.conflicts.toArray(),
	]);
	return {
		whiteboards,
		cards,
		cardContents,
		boardItems,
		files: files.map(({ blob: _blob, ...metadata }) => metadata),
		fileReferences,
		cardReferences,
		cardRelations,
		canvasRecords,
		todos,
		conflicts,
	};
}

export async function importCheckpointEntities(
	db: ContextboardDatabaseLike,
	workspaceId: string,
	entities: Record<string, unknown[]>,
	coveredCursor: string,
	peerId = "contextboard-cloud",
) {
	if (await hasWorkspaceData(db))
		throw new Error("Checkpoint bootstrap requires an empty workspace");
	await db.transaction(
		"rw",
		[
			db.whiteboards,
			db.cards,
			db.cardContents,
			db.boardItems,
			db.tldrawDocuments,
			db.files,
			db.fileReferences,
			db.cardReferences,
			db.cardRelations,
			db.canvasRecords,
			db.todos,
			db.conflicts,
			db.settings,
			db.syncPeers,
		],
		async () => {
			await Promise.all([
				db.whiteboards.bulkPut((entities.whiteboards ?? []) as never[]),
				db.cards.bulkPut((entities.cards ?? []) as never[]),
				db.cardContents.bulkPut((entities.cardContents ?? []) as never[]),
				db.boardItems.bulkPut((entities.boardItems ?? []) as never[]),
				db.tldrawDocuments.bulkPut((entities.tldrawDocuments ?? []) as never[]),
				db.files.bulkPut(
					(entities.files ?? []).map((file) => ({
						...(file as Record<string, unknown>),
						blob: null,
					})) as never[],
				),
				db.fileReferences.bulkPut((entities.fileReferences ?? []) as never[]),
				db.cardReferences.bulkPut((entities.cardReferences ?? []) as never[]),
				db.cardRelations.bulkPut((entities.cardRelations ?? []) as never[]),
				db.canvasRecords.bulkPut((entities.canvasRecords ?? []) as never[]),
				db.todos.bulkPut((entities.todos ?? []) as never[]),
				db.conflicts.bulkPut((entities.conflicts ?? []) as never[]),
			]);
			await db.settings.put({ key: "workspaceId", value: workspaceId });
			await db.syncPeers.put({
				peerId,
				url: "",
				cursor: coveredCursor,
				enabled: true,
				updatedAt: Date.now(),
				lastSyncedAt: Date.now(),
			});
		},
	);
}

export async function checkpointThresholdReached(db: ContextboardDatabaseLike) {
	const [count, bytes] = await Promise.all([
		db.settings.get("checkpointChangeCount"),
		db.settings.get("checkpointChangeBytes"),
	]);
	return (
		(typeof count?.value === "number" && count.value >= 1_000) ||
		(typeof bytes?.value === "number" && bytes.value >= 10 * 1024 * 1024)
	);
}

export async function markCheckpointCreated(
	db: ContextboardDatabaseLike,
	coveredCursor: string,
) {
	await db.settings.bulkPut([
		{ key: "checkpointChangeCount", value: 0 },
		{ key: "checkpointChangeBytes", value: 0 },
		{ key: "checkpointCoveredCursor", value: coveredCursor },
		{ key: "checkpointCreatedAt", value: Date.now() },
	]);
}
