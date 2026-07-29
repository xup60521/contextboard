import "fake-indexeddb/auto";
import {
	type ChangeBatch,
	HybridLogicalClock,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	createContextboardDatabase,
	ensureLocalIdentity,
	IndexedDbWorkspaceRepository,
	runLocalCommand,
} from "./index";

const databases: Array<ReturnType<typeof createContextboardDatabase>> = [];
const makeRepository = async () => {
	const database = createContextboardDatabase(crypto.randomUUID());
	databases.push(database);
	const identity = await ensureLocalIdentity(database);
	return {
		database,
		identity,
		repository: new IndexedDbWorkspaceRepository(database),
	};
};

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("IndexedDbWorkspaceRepository conformance", () => {
	test("persists an atomic local mutation and pending batch across reopen", async () => {
		const { database, identity, repository } = await makeRepository();
		await runLocalCommand(
			database,
			{ ...identity, clock: new HybridLogicalClock(identity.deviceId) },
			"todos.create",
			[database.todos],
			async () => {
				const todo = {
					id: "todo-1",
					text: "Persisted",
					completed: false,
					revision: 1,
					createdAt: 1,
					updatedAt: 1,
					updatedByDeviceId: identity.deviceId,
					deletedAt: null,
				};
				await database.todos.add(todo);
				return {
					result: todo.id,
					changes: [
						{
							entityType: "todo" as const,
							entityId: todo.id,
							baseRevision: null,
							revision: 1,
							operation: "upsert" as const,
							clock: "",
							value: todo,
						},
					],
				};
			},
		);
		const pending = await repository.getPendingBatches(10);
		expect(pending).toHaveLength(1);
		database.close();
		await database.open();
		expect((await database.todos.get("todo-1"))?.text).toBe("Persisted");
		expect(await repository.getPendingBatches(10)).toHaveLength(1);
		await repository.acknowledge([pending[0]!.changeId]);
		expect(await repository.getPendingBatches(10)).toEqual([]);
	});

	test("isolates workspaces and applies remote batches/cursor idempotently", async () => {
		const { database, repository } = await makeRepository();
		const batch: ChangeBatch = {
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId: "remote-1",
			workspaceId: (await database.settings.get("workspaceId"))
				?.value as string,
			deviceId: "remote",
			deviceSequence: 1,
			clock: "0000000000001:000000:remote",
			command: "todos.create",
			createdAt: 1,
			changes: [
				{
					entityType: "todo",
					entityId: "todo-remote",
					baseRevision: null,
					revision: 1,
					operation: "upsert",
					clock: "0000000000001:000000:remote",
					value: {
						id: "todo-remote",
						text: "Remote",
						completed: false,
						revision: 1,
						createdAt: 1,
						updatedAt: 1,
						updatedByDeviceId: "remote",
						deletedAt: null,
					},
				},
			],
		};
		const listener = vi.fn();
		repository.subscribe(listener);
		expect(await repository.applyRemote([batch], "cloud", "1")).toEqual({
			applied: 1,
			conflicts: 0,
		});
		expect(await repository.applyRemote([batch], "cloud", "2")).toEqual({
			applied: 0,
			conflicts: 0,
		});
		expect((await repository.getSyncState("cloud")).cursor).toBe("2");
		expect(await database.todos.count()).toBe(1);
		expect(listener).toHaveBeenCalledTimes(2);

		const mismatch = { ...batch, changeId: "remote-2", workspaceId: "other" };
		await expect(
			repository.applyRemote([mismatch], "cloud", "3"),
		).rejects.toThrow("workspace");
		expect(await database.todos.count()).toBe(1);
	});

	test("commits multiple entities as one atomic batch with one clock", async () => {
		const { repository } = await makeRepository();
		await repository.execute({
			type: "canvas.createPair",
			input: {
				writes: [
					{
						entity: "card",
						operation: "upsert",
						id: "card-pair",
						value: { derivedTitle: "Pair" },
					},
					{
						entity: "boardItem",
						operation: "upsert",
						id: "item-pair",
						value: { cardId: "card-pair", whiteboardId: "board-1" },
					},
				],
			},
		});
		const [batch] = await repository.getPendingBatches(10);
		expect(batch?.changes).toHaveLength(2);
		expect(new Set(batch?.changes.map((change) => change.clock)).size).toBe(1);
		expect(batch?.changes.map((change) => change.revision)).toEqual([1, 1]);
	});

	test("rejects duplicate writes and rolls back the whole conflict", async () => {
		const { database, repository } = await makeRepository();
		await expect(
			repository.execute({
				type: "canvas.invalid",
				input: {
					writes: [
						{
							entity: "card",
							operation: "upsert",
							id: "duplicate",
							value: {},
						},
						{
							entity: "card",
							operation: "upsert",
							id: "duplicate",
							value: {},
						},
					],
				},
			}),
		).rejects.toThrow("same entity");
		expect(await database.cards.get("duplicate")).toBeUndefined();

		await repository.execute({
			type: "cards.create",
			input: { value: { id: "existing" } },
		});
		const batchCount = await database.changeLog.count();
		await expect(
			repository.execute({
				type: "canvas.conflict",
				input: {
					writes: [
						{
							entity: "boardItem",
							operation: "upsert",
							id: "must-rollback",
							value: {},
						},
						{
							entity: "card",
							operation: "upsert",
							id: "existing",
							value: {},
							expectedRevision: 0,
						},
					],
				},
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await database.boardItems.get("must-rollback")).toBeUndefined();
		expect(await database.changeLog.count()).toBe(batchCount);
	});
});
