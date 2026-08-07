import "fake-indexeddb/auto";
import {
	type ChangeBatch,
	conflictCopyCardId,
	HybridLogicalClock,
	parsePushChangesRequest,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	acknowledgeBatches,
	applyRemoteBatches,
	ContextboardDatabase,
	ensureLocalIdentity,
	getPendingBatches,
	importCheckpointEntities,
	rebindWorkspaceId,
	runLocalCommand,
} from "./index";

const databases: ContextboardDatabase[] = [];
const makeDb = () => {
	const db = new ContextboardDatabase(
		`contextboard-test-${crypto.randomUUID()}`,
	);
	databases.push(db);
	return db;
};

afterEach(async () => {
	await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("local database", () => {
	test("creates stable workspace and device identities", async () => {
		const db = makeDb();
		const first = await ensureLocalIdentity(db);
		const second = await ensureLocalIdentity(db);
		expect(second).toEqual(first);
	});

	test("rebinds a merged non-empty workspace and resets its sync cursor", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		await db.todos.add({
			id: "preserved",
			text: "Keep me",
			completed: false,
			revision: 1,
			createdAt: 1,
			updatedAt: 1,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		});
		await db.changeLog.add({
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId: "merged-change",
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			deviceSequence: 1,
			clock: "0000000000001:000000:device",
			command: "todos.add",
			createdAt: 1,
			changes: [],
		});
		await db.appliedChangeBatches.add({
			changeId: "merged-change",
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			deviceSequence: 1,
			appliedAt: 1,
		});
		await db.syncPeers.add({
			peerId: "contextboard-cloud",
			url: "",
			cursor: "99",
			enabled: true,
			updatedAt: 1,
			lastSyncedAt: 1,
		});

		await rebindWorkspaceId(db, identity.workspaceId, "canonical-workspace");

		expect((await db.settings.get("workspaceId"))?.value).toBe(
			"canonical-workspace",
		);
		expect((await db.changeLog.get("merged-change"))?.workspaceId).toBe(
			"canonical-workspace",
		);
		expect(
			(await db.appliedChangeBatches.get("merged-change"))?.workspaceId,
		).toBe("canonical-workspace");
		expect((await db.syncPeers.get("contextboard-cloud"))?.cursor).toBeNull();
		expect(await db.todos.get("preserved")).toMatchObject({ text: "Keep me" });
	});

	test("commits domain writes and their change batch atomically", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const context = {
			...identity,
			clock: new HybridLogicalClock(identity.deviceId),
		};
		await runLocalCommand(db, context, "todos.add", [db.todos], async () => {
			const now = Date.now();
			await db.todos.add({
				id: "todo-1",
				text: "Local",
				completed: false,
				revision: 1,
				createdAt: now,
				updatedAt: now,
				updatedByDeviceId: identity.deviceId,
				deletedAt: null,
			});
			return {
				result: undefined,
				changes: [
					{
						entityType: "todo",
						entityId: "todo-1",
						baseRevision: null,
						revision: 1,
						operation: "upsert",
						clock: "",
						value: { text: "Local", completed: false },
					},
				],
			};
		});
		expect(await db.todos.count()).toBe(1);
		expect(await db.changeLog.count()).toBe(1);
	});

	test("rebuilds legacy argument logs as a valid materialized post-state batch", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const now = Date.now();
		await db.todos.add({
			id: "todo-offline",
			text: "Preserved local value",
			completed: false,
			revision: 3,
			createdAt: now,
			updatedAt: now,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		});
		await db.changeLog.add({
			protocolVersion: 1,
			changeId: "legacy-change",
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			sequence: 1,
			clock: "legacy",
			command: "todos.add",
			createdAt: now,
			changes: [{ value: { text: "stale mutation arguments" } }],
		} as never);

		const batches = await getPendingBatches(db, 100);
		expect(batches).toHaveLength(1);
		expect(() =>
			parsePushChangesRequest({
				workspaceId: identity.workspaceId,
				batches,
				cursor: null,
			}),
		).not.toThrow();
		expect(batches[0]?.command).toBe("migration.rebuildPendingChanges");
		expect(batches[0]?.changes).toContainEqual(
			expect.objectContaining({
				entityType: "todo",
				entityId: "todo-offline",
				revision: 3,
				value: expect.objectContaining({ text: "Preserved local value" }),
			}),
		);
		expect(JSON.stringify(batches)).not.toContain("stale mutation arguments");
	});

	test("limits a versioned 10,000-row pending log before materialization", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		await db.settings.put({ key: "changeLogFormatVersion", value: 2 });
		const batches = Array.from({ length: 10_000 }, (_, index): ChangeBatch => ({
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId: `pending-${index.toString().padStart(5, "0")}`,
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			deviceSequence: index + 1,
			clock: `${(index + 1).toString().padStart(13, "0")}:000000:${identity.deviceId}`,
			command: "performance.fixture",
			createdAt: index,
			changes: [],
		}));
		await db.changeLog.bulkAdd(batches);

		let appliedLimit: number | null = null;
		const orderBy = db.changeLog.orderBy.bind(db.changeLog);
		const orderBySpy = vi
			.spyOn(db.changeLog, "orderBy")
			.mockImplementation(((index: string) => {
				const ordered = orderBy(index);
				const limit = ordered.limit.bind(ordered);
				ordered.limit = ((count: number) => {
					appliedLimit = count;
					return limit(count);
				}) as typeof ordered.limit;
				return ordered;
			}) as typeof db.changeLog.orderBy);

		const pending = await getPendingBatches(db, 100);
		orderBySpy.mockRestore();
		expect(appliedLimit).toBe(100);
		expect(pending).toHaveLength(100);
		expect(pending[0]?.changeId).toBe("pending-00000");
		expect(pending.at(-1)?.changeId).toBe("pending-00099");
	});

	test("rebuilds every syncable entity, excludes binary snapshots, and is idempotent", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const now = Date.now();
		const base = {
			revision: 1,
			createdAt: now,
			updatedAt: now,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		};
		await db.whiteboards.put({
			...base,
			id: "board-1",
			title: "Board",
			parentWhiteboardId: null,
			ancestorIds: [],
			depth: 0,
			sortKey: "a",
			pathKey: "a",
			cardCount: 1,
			childWhiteboardCount: 0,
			archivedAt: null,
		} as never);
		await db.cards.put({
			...base,
			id: "card-1",
			derivedTitle: "Card",
			content: { type: "doc", content: [{ type: "paragraph" }] },
			archivedAt: null,
			activePlacementCount: 1,
		} as never);
		await db.boardItems.put({
			...base,
			id: "placement-1",
			whiteboardId: "board-1",
			shapeId: "shape-1",
			kind: "card",
			cardId: "card-1",
			childWhiteboardId: null,
			x: 10,
			y: 20,
			w: 300,
			h: 200,
			rotation: 0,
			zIndex: 1,
			archivedAt: null,
		} as never);
		await db.cardReferences.put({
			...base,
			id: "reference-1",
			sourceCardId: "card-1",
			targetCardId: "card-2",
		} as never);
		await db.cardRelations.put({
			...base,
			id: "relation-1",
			whiteboardId: "board-1",
			sourceCardId: "card-1",
			targetCardId: "card-2",
			relationType: "supports",
			ordinal: 1,
			clock: "0000000000001:000000:device-1",
		} as never);
		await db.files.put({
			...base,
			id: "file-1",
			sha256: "a".repeat(64),
			contentType: "image/png",
			size: 3,
			status: "available",
			blob: new Blob(["raw"]),
			pendingDeleteAt: null,
		} as never);
		await db.fileReferences.put({
			...base,
			id: "file-reference-1",
			fileId: "file-1",
			targetKey: "card:card-1",
		} as never);
		await db.canvasRecords.put({
			...base,
			id: "board-1:shape-existing",
			whiteboardId: "board-1",
			recordId: "shape-existing",
			recordType: "shape",
			payload: { id: "shape-existing", typeName: "shape", type: "arrow" },
			clock: "0000000000001:000000:device-1",
		} as never);
		await db.tldrawDocuments.put({
			...base,
			id: "document-1",
			whiteboardId: "board-1",
			snapshot: {
				store: {
					"shape:arrow": {
						id: "shape:arrow",
						typeName: "shape",
						type: "arrow",
					},
					"shape:managed": {
						id: "shape:managed",
						typeName: "shape",
						type: "markdown-card",
					},
				},
			},
		} as never);
		await db.appliedChangeBatches.put({
			changeId: "server-known",
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			deviceSequence: 40,
			appliedAt: now,
		});
		await db.settings.put({ key: "deviceSequence", value: 2 });
		await db.changeLog.add({
			protocolVersion: 1,
			changeId: "legacy-arguments",
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			sequence: 7,
			clock: "legacy",
			command: "cards.update",
			createdAt: now,
			changes: [{ args: { content: "stale mutation arguments" } }],
		} as never);

		const [rebuilt] = await getPendingBatches(db, 100);
		expect(rebuilt.deviceSequence).toBe(41);
		expect(new Set(rebuilt.changes.map((change) => change.entityType))).toEqual(
			new Set([
				"whiteboard",
				"card",
				"boardItem",
				"file",
				"fileReference",
				"cardReference",
				"cardRelation",
				"canvasRecord",
			]),
		);
		expect(
			rebuilt.changes.find(
				(change) =>
					change.entityType === "canvasRecord" &&
					change.entityId === "board-1:shape:arrow",
			),
		).toBeDefined();
		expect(
			rebuilt.changes.find((change) => change.entityType === "file")?.value,
		).toMatchObject({ hash: "a".repeat(64), size: 3 });
		const serialized = JSON.stringify(rebuilt);
		expect(serialized).not.toContain("stale mutation arguments");
		expect(serialized).not.toContain('"snapshot"');
		expect(serialized).not.toContain('"blob"');
		expect(serialized).not.toContain("shape:managed");

		const [second] = await getPendingBatches(db, 100);
		expect(second.changeId).toBe(rebuilt.changeId);
		expect(second.deviceSequence).toBe(41);
	});

	test("rolls back a crashed legacy migration transaction", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const now = Date.now();
		await db.tldrawDocuments.put({
			id: "document-1",
			whiteboardId: "board-1",
			snapshot: {
				store: {
					"shape:collision": {
						id: "shape:collision",
						typeName: "shape",
						type: "arrow",
					},
				},
			},
			revision: 1,
			createdAt: now,
			updatedAt: now,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		} as never);
		await db.canvasRecords.put({
			id: "board-1:shape:collision",
			whiteboardId: "different-board",
			recordId: "different-record",
			recordType: "shape",
			payload: { id: "different-record" },
			clock: "legacy",
			revision: 1,
			createdAt: now,
			updatedAt: now,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		} as never);
		await db.changeLog.add({
			changeId: "legacy-change",
			workspaceId: identity.workspaceId,
			deviceId: identity.deviceId,
			sequence: 1,
			createdAt: now,
			changes: [{ args: true }],
		} as never);

		await expect(getPendingBatches(db, 100)).rejects.toThrow();
		expect(await db.changeLog.get("legacy-change")).toBeDefined();
		expect(await db.canvasRecords.count()).toBe(1);
		expect((await db.settings.get("deviceSequence"))?.value).toBeUndefined();
	});

	test("skips an echoed local batch while atomically advancing the cursor", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		await runLocalCommand(
			db,
			{ ...identity, clock: new HybridLogicalClock(identity.deviceId) },
			"todos.add",
			[db.todos],
			async () => {
				const now = Date.now();
				const row = {
					id: "todo-1",
					text: "Local",
					completed: false,
					revision: 1,
					createdAt: now,
					updatedAt: now,
					updatedByDeviceId: identity.deviceId,
					deletedAt: null,
				};
				await db.todos.add(row);
				return {
					result: undefined,
					changes: [
						{
							entityType: "todo" as const,
							entityId: row.id,
							baseRevision: null,
							revision: 1,
							operation: "upsert" as const,
							clock: "",
							value: row,
						},
					],
				};
			},
		);
		const [localBatch] = await db.changeLog.toArray();
		await acknowledgeBatches(db, [localBatch.changeId]);
		const result = await applyRemoteBatches(
			db,
			[localBatch],
			"contextboard-cloud",
			"7",
		);
		expect(result).toMatchObject({ applied: 0, conflicts: 0 });
		expect(result.materializedChanges).toEqual([]);
		expect((await db.syncPeers.get("contextboard-cloud"))?.cursor).toBe("7");
		expect(await db.todos.count()).toBe(1);
	});

	test("rolls back both data and log when a command fails", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const context = {
			...identity,
			clock: new HybridLogicalClock(identity.deviceId),
		};
		await expect(
			runLocalCommand(db, context, "todos.fail", [db.todos], async () => {
				const now = Date.now();
				await db.todos.add({
					id: "todo-1",
					text: "Nope",
					completed: false,
					revision: 1,
					createdAt: now,
					updatedAt: now,
					updatedByDeviceId: identity.deviceId,
					deletedAt: null,
				});
				throw new Error("injected failure");
			}),
		).rejects.toThrow("injected failure");
		expect(await db.todos.count()).toBe(0);
		expect(await db.changeLog.count()).toBe(0);
	});

	test("rejects a remote whiteboard with a missing parent and records an audit", async () => {
		const db = makeDb();
		const remote: ChangeBatch = {
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId: "remote-1",
			workspaceId: "workspace-1",
			deviceId: "device-2",
			deviceSequence: 1,
			clock: "0000000000001:000001:device-2",
			command: "whiteboards.create",
			createdAt: 1,
			changes: [
				{
					entityType: "whiteboard",
					entityId: "board-1",
					baseRevision: null,
					revision: 1,
					operation: "upsert",
					clock: "0000000000001:000001:device-2",
					value: {
						id: "board-1",
						title: "Invalid",
						parentWhiteboardId: "missing",
						ancestorIds: ["missing"],
						depth: 1,
						sortKey: "a",
						pathKey: "a",
						cardCount: 0,
						childWhiteboardCount: 0,
						archivedAt: null,
						revision: 1,
						createdAt: 1,
						updatedAt: 1,
						updatedByDeviceId: "device-2",
						deletedAt: null,
					},
				},
			],
		};
		const result = await applyRemoteBatches(
			db,
			[remote],
			"contextboard-cloud",
			"1",
		);
		expect(result.conflicts).toBe(1);
		expect(await db.whiteboards.count()).toBe(0);
		expect(await db.conflicts.count()).toBe(1);
	});

	test("creates one deterministic, metadata-preserving conflict copy on both peers", async () => {
		const dbA = makeDb();
		const dbB = makeDb();
		const card = (deviceId: string, title: string, marker: string) => ({
			id: "card-1",
			content: {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "text", text: title },
							{
								type: "image",
								attrs: { fileId: `file-${marker}`, hash: marker.repeat(64) },
							},
						],
					},
				],
			},
			derivedTitle: title,
			plainText: title,
			preview: title,
			contentVersion: 2,
			activePlacementCount: 1,
			archivedAt: null,
			revision: 2,
			createdAt: 1,
			updatedAt: 2,
			updatedByDeviceId: deviceId,
			deletedAt: null,
			customMetadata: { marker },
		});
		const cardA = card("device-a", "Local A", "a");
		const cardB = card("device-b", "Remote B", "b");
		for (const [db, value] of [
			[dbA, cardA],
			[dbB, cardB],
		] as const) {
			await db.cards.put(value as never);
			await db.cardContents.put({
				id: "card-1",
				cardId: "card-1",
				document: value.content,
				contentVersion: value.contentVersion,
				clock: `0000000000002:000000:${value.updatedByDeviceId}`,
				revision: value.revision,
				createdAt: value.createdAt,
				updatedAt: value.updatedAt,
				updatedByDeviceId: value.updatedByDeviceId,
				deletedAt: null,
			} as never);
			await db.boardItems.put({
				id: "placement-1",
				whiteboardId: "board-1",
				kind: "card",
				cardId: "card-1",
				childWhiteboardId: null,
				shapeId: "shape:card",
				x: 10,
				y: 20,
				w: 300,
				h: 200,
				rotation: 0,
				zIndex: 1,
				archivedAt: null,
				revision: 1,
				createdAt: 1,
				updatedAt: 1,
				updatedByDeviceId: value.updatedByDeviceId,
				deletedAt: null,
			} as never);
			await db.cardReferences.put({
				id: "reference-1",
				sourceCardId: "card-1",
				targetCardId: "target-1",
				revision: 1,
				createdAt: 1,
				updatedAt: 1,
				updatedByDeviceId: value.updatedByDeviceId,
				deletedAt: null,
			} as never);
		}
		const remoteBatch = (
			changeId: string,
			deviceId: string,
			value: ReturnType<typeof card>,
		): ChangeBatch => ({
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId,
			workspaceId: "workspace-1",
			deviceId,
			deviceSequence: 1,
			clock: `0000000000002:000000:${deviceId}`,
			command: "cards.updateContent",
			createdAt: 2,
			changes: [
				{
					entityType: "card",
					entityId: "card-1",
					baseRevision: 1,
					revision: 2,
					operation: "upsert",
					clock: `0000000000002:000000:${deviceId}`,
					value,
				},
				{
					entityType: "cardContent",
					entityId: "card-1",
					baseRevision: 1,
					revision: 2,
					operation: "upsert",
					clock: `0000000000002:000000:${deviceId}`,
					value: {
						id: "card-1",
						cardId: "card-1",
						document: value.content,
						contentVersion: value.contentVersion,
						clock: `0000000000002:000000:${deviceId}`,
						revision: 2,
						createdAt: 1,
						updatedAt: 2,
						updatedByDeviceId: deviceId,
						deletedAt: null,
					},
				},
			],
		});
		const fromB = remoteBatch("change-b", "device-b", cardB);
		const fromA = remoteBatch("change-a", "device-a", cardA);

		await applyRemoteBatches(dbA, [fromB], "cloud", "1");
		await applyRemoteBatches(dbB, [fromA], "cloud", "1");
		await applyRemoteBatches(dbA, [fromB], "cloud", "1");

		const conflictsA = await dbA.conflicts.toArray();
		const conflictsB = await dbB.conflicts.toArray();
		expect(conflictsA).toHaveLength(1);
		expect(conflictsB).toHaveLength(1);
		expect(conflictsA[0]?.conflictId).toBe(conflictsB[0]?.conflictId);
		const copyId = conflictCopyCardId(conflictsA[0]?.conflictId ?? "");
		const copyA = await dbA.cards.get(copyId);
		const copyB = await dbB.cards.get(copyId);
		expect(copyA?.content).toEqual(cardB.content);
		expect(copyB?.content).toEqual(cardA.content);
		expect((await dbA.cardContents.get(copyId))?.document).toEqual(cardB.content);
		expect((await dbB.cardContents.get(copyId))?.document).toEqual(cardA.content);
		expect((await dbA.cardContents.get("card-1"))?.document).toEqual(cardA.content);
		expect(
			(copyA as unknown as { customMetadata: unknown }).customMetadata,
		).toEqual(cardB.customMetadata);
		expect(
			(await dbA.boardItems.where("cardId").equals(copyId).first())?.x,
		).toBe(58);
		expect(
			await dbA.cardReferences.where("sourceCardId").equals(copyId).count(),
		).toBe(1);
	});

	test("bootstraps checkpoint state and its covered cursor into an empty database", async () => {
		const db = makeDb();
		await ensureLocalIdentity(db);
		await importCheckpointEntities(
			db,
			"workspace-server",
			{
				todos: [
					{
						id: "todo-server",
						text: "Bootstrapped",
						completed: false,
						revision: 1,
						createdAt: 1,
						updatedAt: 1,
						updatedByDeviceId: "device-server",
						deletedAt: null,
					},
				],
			},
			"42",
		);
		expect((await db.settings.get("workspaceId"))?.value).toBe(
			"workspace-server",
		);
		expect((await db.syncPeers.get("contextboard-cloud"))?.cursor).toBe("42");
		expect(await db.todos.count()).toBe(1);
	});
});
