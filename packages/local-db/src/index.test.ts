import "fake-indexeddb/auto";
import {
	type ChangeBatch,
	HybridLogicalClock,
	parsePushChangesRequest,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { afterEach, describe, expect, test } from "vitest";
import {
	acknowledgeBatches,
	applyRemoteBatches,
	ContextboardDatabase,
	ensureLocalIdentity,
	getPendingBatches,
	importCheckpointEntities,
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
		expect(result).toEqual({ applied: 0, conflicts: 0 });
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
