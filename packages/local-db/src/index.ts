import {
	type BoardItem,
	type CanvasRecord,
	type Card,
	type CardReference,
	type CardRelation,
	type FileReference,
	hasHierarchyCycle,
	type LocalFile,
	type TldrawDocument,
	type Whiteboard,
} from "@contextboard/domain";
import {
	type BlobDescriptor,
	type ChangeBatch,
	type ConflictRecord,
	type EntityChange,
	type HybridLogicalClock,
	parseChangeBatch,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
	type SyncEntityType,
} from "@contextboard/sync-protocol";
import Dexie, { type EntityTable, type Table, type Transaction } from "dexie";

export type ApplyRemoteResult = { applied: number; conflicts: number };

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
		[...tables, db.changeLog, db.settings, db.appliedChangeBatches],
		async (transaction) => {
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
			await db.settings.bulkPut([
				{
					key: "checkpointChangeCount",
					value:
						(typeof checkpointCount?.value === "number"
							? checkpointCount.value
							: 0) + 1,
				},
				{
					key: "checkpointChangeBytes",
					value:
						(typeof checkpointBytes?.value === "number"
							? checkpointBytes.value
							: 0) + new TextEncoder().encode(JSON.stringify(batch)).byteLength,
				},
			]);
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

export async function getPendingBatches(
	db: ContextboardDatabase,
	limit: number,
) {
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
	return current.slice(0, Math.max(1, limit));
}

/**
 * The pre-sync prototype logged mutation arguments and used `sequence` instead
 * of the versioned ChangeBatch contract. Those batches cannot be transported
 * safely. Rebuild one post-state batch from the local materialized truth so no
 * offline user data is discarded.
 */
async function rebuildLegacyPendingBatches(
	db: ContextboardDatabase,
): Promise<ChangeBatch[]> {
	const transactionTables = [
		db.whiteboards,
		db.cards,
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
		if (!stillHasLegacy) return pending;

		const workspaceId = (await db.settings.get("workspaceId"))?.value;
		const deviceId = (await db.settings.get("deviceId"))?.value;
		if (typeof workspaceId !== "string" || typeof deviceId !== "string")
			throw new Error("Local workspace identity is unavailable");

		const now = Date.now();
		const sequenceSetting = await db.settings.get("deviceSequence");
		const deviceSequence =
			typeof sequenceSetting?.value === "number"
				? sequenceSetting.value + 1
				: 1;
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

		const sources: Array<[SyncEntityType, Table]> = [
			["whiteboard", db.whiteboards],
			["card", db.cards],
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
			command: "migration.rebuildPendingChanges",
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
		await db.settings.put({ key: "deviceSequence", value: deviceSequence });
		return [rebuilt];
	});
}

export async function acknowledgeBatches(
	db: ContextboardDatabase,
	changeIds: string[],
) {
	await db.changeLog.bulkDelete(changeIds);
}

const remoteTable = (
	db: ContextboardDatabase,
	entityType: string,
): Table | null =>
	entityType === "whiteboard"
		? db.whiteboards
		: entityType === "card"
			? db.cards
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
	db: ContextboardDatabase,
	batches: ChangeBatch[],
	peerId = "contextboard-cloud",
	nextCursor?: string,
): Promise<ApplyRemoteResult> {
	let applied = 0;
	let conflicts = 0;
	const tables = [
		db.whiteboards,
		db.cards,
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
		let needsCountRebuild = false;
		for (const batch of batches) {
			if (await db.appliedChangeBatches.get(batch.changeId)) continue;
			newlyAppliedBatches++;
			newlyAppliedBytes += new TextEncoder().encode(
				JSON.stringify(batch),
			).byteLength;
			for (const change of batch.changes) {
				const table = remoteTable(db, change.entityType);
				if (!table || !change.value || typeof change.value !== "object")
					continue;
				const incoming = change.value as Record<string, unknown>;
				const materialized =
					change.entityType === "file"
						? {
								...incoming,
								sha256: String(incoming.hash ?? incoming.sha256 ?? ""),
								blob: null,
							}
						: incoming;
				const local = (await table.get(change.entityId)) as
					| Record<string, unknown>
					| undefined;
				if (change.entityType === "whiteboard") {
					const rows = await db.whiteboards.toArray();
					const byId = new Map(rows.map((row) => [row.id, row] as const));
					const parentId = (materialized.parentWhiteboardId ?? null) as never;
					const invalid =
						(parentId !== null && !byId.has(parentId)) ||
						hasHierarchyCycle(change.entityId as never, parentId, byId);
					if (invalid) {
						const conflictId = `hierarchy:${change.entityId}:${batch.changeId}`;
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
					const conflictId = `conflict:${change.entityId}:${batch.changeId}`;
					if (!(await db.conflicts.get(conflictId))) {
						const conflictCardId = `card:${conflictId}`;
						await db.cards.put({
							...materialized,
							id: conflictCardId,
							derivedTitle: `Conflict: ${String(incoming.derivedTitle ?? "Untitled card")}`,
						} as never);
						const placement = await db.boardItems
							.where("cardId")
							.equals(change.entityId)
							.first();
						if (placement) {
							await db.boardItems.put({
								...placement,
								id: `placement:${conflictId}`,
								cardId: conflictCardId,
								shapeId: `shape:${conflictId}`,
								x: placement.x + 48,
								y: placement.y + 48,
							} as never);
							needsCountRebuild = true;
						}
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
				await table.put(materialized);
				if (
					change.entityType === "whiteboard" ||
					change.entityType === "boardItem"
				)
					needsCountRebuild = true;
				applied++;
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
		if (needsCountRebuild) {
			const whiteboards = await db.whiteboards.toArray();
			for (const whiteboard of whiteboards) {
				if (whiteboard.deletedAt !== null) continue;
				const [cardCount, childWhiteboardCount] = await Promise.all([
					db.boardItems
						.filter(
							(item) =>
								item.whiteboardId === whiteboard.id &&
								item.kind === "card" &&
								item.deletedAt === null &&
								item.archivedAt === null,
						)
						.count(),
					db.whiteboards
						.filter(
							(child) =>
								child.parentWhiteboardId === whiteboard.id &&
								child.deletedAt === null &&
								child.archivedAt === null,
						)
						.count(),
				]);
				if (
					whiteboard.cardCount !== cardCount ||
					whiteboard.childWhiteboardCount !== childWhiteboardCount
				)
					await db.whiteboards.update(whiteboard.id, {
						cardCount,
						childWhiteboardCount,
					});
			}
		}
	});
	return { applied, conflicts };
}

export async function getSyncState(
	db: ContextboardDatabase,
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

export async function hasWorkspaceData(db: ContextboardDatabase) {
	const counts = await Promise.all([
		db.whiteboards.count(),
		db.cards.count(),
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
	db: ContextboardDatabase,
	workspaceId: string,
) {
	if (await hasWorkspaceData(db))
		throw new Error("A non-empty local workspace cannot be replaced");
	await db.settings.put({ key: "workspaceId", value: workspaceId });
}

export async function getLocalBlob(db: ContextboardDatabase, hash: string) {
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
	db: ContextboardDatabase,
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

export async function getMissingBlobs(db: ContextboardDatabase) {
	return (await db.files.toArray())
		.filter((file) => file.blob === null && file.deletedAt === null)
		.map((file) => ({
			hash: file.sha256,
			contentType: file.contentType,
			size: file.size,
		}));
}

export async function exportCheckpointEntities(db: ContextboardDatabase) {
	const [
		whiteboards,
		cards,
		boardItems,
		tldrawDocuments,
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
		db.boardItems.toArray(),
		db.tldrawDocuments.toArray(),
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
		boardItems,
		tldrawDocuments,
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
	db: ContextboardDatabase,
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

export async function checkpointThresholdReached(db: ContextboardDatabase) {
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
	db: ContextboardDatabase,
	coveredCursor: string,
) {
	await db.settings.bulkPut([
		{ key: "checkpointChangeCount", value: 0 },
		{ key: "checkpointChangeBytes", value: 0 },
		{ key: "checkpointCoveredCursor", value: coveredCursor },
		{ key: "checkpointCreatedAt", value: Date.now() },
	]);
}
