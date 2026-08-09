import "fake-indexeddb/auto";
import {
	type ChangeBatch,
	ENTITY_MANIFEST,
	HybridLogicalClock,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import Dexie from "dexie";
import { SUPPORTED_ENTITY_TYPES } from "./entity-store";
import {
	createContextboardDatabase,
	ensureLocalIdentity,
	IndexedDbWorkspaceRepository,
	runLocalCommand,
} from "./index";

test("the IndexedDB allowlist exactly matches the shared entity manifest", () => {
	expect(SUPPORTED_ENTITY_TYPES).toEqual(
		Object.keys(ENTITY_MANIFEST.entities).sort(),
	);
});

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
	test("version 8 externalizes legacy card bodies before clearing them", async () => {
		const name = `contextboard-v7-${crypto.randomUUID()}`;
		const legacy = new Dexie(name);
		legacy.version(7).stores({
			cards: "id, updatedAt, deletedAt",
			cardContents: "id, &cardId, contentVersion, clock, updatedAt, deletedAt",
			files: "id, &sha256, status, pendingDeleteAt, deletedAt",
		});
		await legacy.open();
		const document = { type: "doc", content: [{ type: "paragraph" }] };
		await legacy.table("cards").put({
			id: "legacy-card",
			content: document,
			contentVersion: 4,
			revision: 3,
			createdAt: 1,
			updatedAt: 2,
			updatedByDeviceId: "legacy-device",
			deletedAt: null,
		});
		legacy.close();

		const database = createContextboardDatabase(name);
		databases.push(database);
		await database.open();
		expect((await database.cards.get("legacy-card" as never))?.content).toBeNull();
		expect(
			(await database.cardContents.get("legacy-card" as never))?.document,
		).toEqual(document);
	});

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
		expect(await repository.applyRemote([batch], "cloud", "1")).toMatchObject({
			applied: 1,
			conflicts: 0,
		});
		expect(await repository.applyRemote([batch], "cloud", "2")).toMatchObject({
			applied: 0,
			conflicts: 0,
		});
		expect((await repository.getSyncState("cloud")).cursor).toBe("2");
		expect(await database.todos.count()).toBe(1);
		// Replaying an already-applied batch changes no materialized row and emits
		// no repository invalidation.
		expect(listener).toHaveBeenCalledTimes(1);

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

	test("delivers structured changes only to matching subscriptions", async () => {
		const { repository } = await makeRepository();
		const cards = vi.fn();
		const boardA = vi.fn();
		const boardB = vi.fn();
		repository.subscribe(cards, { entityTypes: ["card"] });
		repository.subscribe(boardA, {
			entityTypes: ["boardItem"],
			whiteboardIds: ["board-a"],
		});
		repository.subscribe(boardB, {
			entityTypes: ["boardItem"],
			whiteboardIds: ["board-b"],
		});
		await repository.execute({
			type: "items.create",
			input: {
				writes: [
					{
						entity: "boardItem",
						operation: "upsert",
						id: "item-a",
						value: { whiteboardId: "board-a", cardId: "card-a" },
					},
				],
			},
		});
		expect(cards).not.toHaveBeenCalled();
		expect(boardA).toHaveBeenCalledWith({
			origin: "local",
			changes: [
				expect.objectContaining({
					entityType: "boardItem",
					entityId: "item-a",
					whiteboardId: "board-a",
					cardId: "card-a",
				}),
			],
		});
		expect(boardB).not.toHaveBeenCalled();

		boardA.mockClear();
		await repository.execute({
			type: "items.delete",
			input: {
				writes: [
					{
						entity: "boardItem",
						operation: "delete",
						id: "item-a",
					},
				],
			},
		});
		expect(boardA).toHaveBeenCalledWith({
			origin: "local",
			changes: [
				expect.objectContaining({
					entityType: "boardItem",
					entityId: "item-a",
					whiteboardId: "board-a",
				}),
			],
		});
		expect(boardB).not.toHaveBeenCalled();
	});

	test("accepts manifest-backed card content, conflict, and todo entities", async () => {
		const { repository } = await makeRepository();
		await repository.execute({
			type: "manifest.seed",
			input: {
				writes: [
					{
						entity: "cardContent",
						operation: "upsert",
						id: "card-a",
						value: { cardId: "card-a", document: { type: "doc" } },
					},
					{
						entity: "todo",
						operation: "upsert",
						id: "todo-a",
						value: { text: "Follow up" },
					},
					{
						entity: "conflict",
						operation: "upsert",
						id: "conflict-a",
						value: { entityType: "card", entityId: "card-a" },
					},
				],
			},
		});
		expect(
			await repository.query({
				type: "cardContents.get",
				input: { id: "card-a" },
			}),
		).toMatchObject({ cardId: "card-a", document: { type: "doc" } });
		expect(
			await repository.query({ type: "todos.get", input: { id: "todo-a" } }),
		).toMatchObject({ text: "Follow up" });
		expect(
			await repository.query({
				type: "conflicts.get",
				input: { id: "conflict-a" },
			}),
		).toMatchObject({ conflictId: "conflict-a" });
	});

	test("pushes list filters into indexed entity reads", async () => {
		const { repository } = await makeRepository();
		await repository.execute({
			type: "filter.seed",
			input: {
				writes: [
					{
						entity: "boardItem",
						operation: "upsert",
						id: "item-a",
						value: { whiteboardId: "board-a" },
					},
					{
						entity: "boardItem",
						operation: "upsert",
						id: "item-b",
						value: { whiteboardId: "board-b" },
					},
					{
						entity: "boardItem",
						operation: "upsert",
						id: "item-root",
						value: { whiteboardId: null },
					},
					{
						entity: "card",
						operation: "upsert",
						id: "card-a",
						value: { derivedTitle: "A" },
					},
					{
						entity: "card",
						operation: "upsert",
						id: "card-b",
						value: { derivedTitle: "B" },
					},
				],
			},
		});
		const deleteBatch = await repository.execute({
			type: "filter.delete",
			input: {
				writes: [
					{
						entity: "boardItem",
						operation: "delete",
						id: "item-b",
						expectedRevision: 1,
					},
				],
			},
		});
		expect(deleteBatch).toHaveLength(1);

		const byBoard = await repository.query<Array<{ id: string }>>({
			type: "items.list",
			input: { whiteboardId: "board-a" },
		});
		const rootItems = await repository.query<Array<{ id: string }>>({
			type: "items.list",
			input: { whiteboardId: null },
		});
		expect(byBoard.map((row) => row.id)).toEqual(["item-a"]);
		expect(rootItems.map((row) => row.id)).toEqual(["item-root"]);

		const cards = await repository.query<Array<{ id: string }>>({
			type: "cards.list",
			input: { ids: ["card-b", "missing", "card-a", "card-a"] },
		});
		expect(cards.map((row) => row.id)).toEqual(["card-a", "card-b"]);
		expect(
			await repository.query({ type: "cards.list", input: { ids: [] } }),
		).toEqual([]);
		const largeIds = [
			...Array.from({ length: 1_100 }, (_, index) => `missing-${index}`),
			"card-a",
		];
		expect(
			(
				await repository.query<Array<{ id: string }>>({
					type: "cards.list",
					input: { ids: largeIds },
				})
			).map((row) => row.id),
		).toEqual(["card-a"]);
		await expect(
			repository.query({
				type: "cards.list",
				input: { whiteboardId: "board-a" },
			}),
		).rejects.toThrow("whiteboardId filtering");
	});

	test("bounds indexed search results and projects card summaries", async () => {
		const { database, repository } = await makeRepository();
		await repository.execute({
			type: "cards.seedSearch",
			input: {
				writes: Array.from({ length: 20 }, (_, index) => ({
					entity: "card",
					operation: "upsert",
					id: `search-${index}`,
					value: {
						derivedTitle: `Needle ${index}`,
						plainText: "needle",
						content: { large: "x".repeat(1_000) },
						updatedAt: index + 1,
					},
				})),
			},
		});
		const fullTableRead = vi.spyOn(database.cards, "toArray");
		const rows = await repository.query<Array<Record<string, unknown>>>({
			type: "cards.list",
			input: { searchTerm: "needle", limit: 3, projection: "summary" },
		});
		expect(rows).toHaveLength(3);
		expect(rows.map((row) => Number(row.updatedAt))).toEqual(
			[...rows]
				.map((row) => Number(row.updatedAt))
				.sort((left, right) => right - left),
		);
		expect(rows.every((row) => !("content" in row))).toBe(true);
		expect(fullTableRead).not.toHaveBeenCalled();
	});

	test("round trips and filters whiteboard references", async () => {
		const { repository } = await makeRepository();
		await repository.execute({
			type: "whiteboardReferences.update",
			input: {
				writes: [
					{ entity: "whiteboardReference", operation: "upsert", id: "card-1:board-1", value: { sourceCardId: "card-1", targetWhiteboardId: "board-1" } },
					{ entity: "whiteboardReference", operation: "upsert", id: "card-2:board-2", value: { sourceCardId: "card-2", targetWhiteboardId: "board-2" } },
				],
			},
		});
		const bySource = await repository.query<Array<Record<string, unknown>>>({ type: "whiteboardReferences.list", input: { sourceCardIds: ["card-1"] } });
		const byTarget = await repository.query<Array<Record<string, unknown>>>({ type: "whiteboardReferences.list", input: { targetWhiteboardIds: ["board-2"] } });
		expect(bySource.map((row) => row.id)).toEqual(["card-1:board-1"]);
		expect(byTarget.map((row) => row.id)).toEqual(["card-2:board-2"]);
	});

	test("reads file reference metadata without returning the blob", async () => {
		const { database, repository } = await makeRepository();
		await database.files.put({
			id: "file-1" as never,
			sha256: "a".repeat(64),
			name: "large.bin",
			mimeType: "application/octet-stream",
			size: 4,
			blob: new Blob(["data"]),
			status: "active",
			refCount: 1,
			pendingDeleteAt: null,
			revision: 7,
			createdAt: 1,
			updatedAt: 1,
			updatedByDeviceId: "device",
			deletedAt: null,
		});
		const rows = await repository.query<Array<Record<string, unknown>>>({
			type: "files.list",
			input: { ids: ["file-1"], projection: "summary" },
		});
		expect(rows).toEqual([{ id: "file-1", revision: 7 }]);
	});

	test("commits every cascade entity type in one sync batch", async () => {
		const { repository } = await makeRepository();
		await repository.execute({
			type: "whiteboards.archiveTree",
			input: {
				writes: [
					{
						entity: "whiteboard",
						operation: "upsert",
						id: "cascade-board",
						value: { parentWhiteboardId: null },
					},
					{
						entity: "boardItem",
						operation: "upsert",
						id: "cascade-item",
						value: { whiteboardId: "cascade-board" },
					},
					{
						entity: "card",
						operation: "upsert",
						id: "cascade-card",
						value: { activePlacementCount: 1 },
					},
					{
						entity: "tldrawDocument",
						operation: "upsert",
						id: "cascade-document",
						value: { whiteboardId: "cascade-board" },
					},
					{
						entity: "canvasRecord",
						operation: "upsert",
						id: "cascade-record",
						value: { whiteboardId: "cascade-board" },
					},
					{
						entity: "file",
						operation: "upsert",
						id: "cascade-file",
						value: { sha256: "cascade-file-hash" },
					},
					{
						entity: "fileReference",
						operation: "upsert",
						id: "cascade-file-reference",
						value: {
							fileId: "cascade-file",
							targetKey: "tldrawDocument:cascade-document",
						},
					},
					{
						entity: "cardReference",
						operation: "upsert",
						id: "cascade-card-reference",
						value: { sourceCardId: "cascade-card", targetCardId: "other" },
					},
					{
						entity: "cardRelation",
						operation: "upsert",
						id: "cascade-relation",
						value: { whiteboardId: "cascade-board" },
					},
				],
			},
		});

		const pending = await repository.getPendingBatches(10);
		expect(pending).toHaveLength(1);
		expect(
			new Set(pending[0]?.changes.map((change) => change.entityType)),
		).toEqual(
			new Set([
				"whiteboard",
				"boardItem",
				"card",
				"tldrawDocument",
				"canvasRecord",
				"file",
				"fileReference",
				"cardReference",
				"cardRelation",
			]),
		);
		expect(pending[0]?.changes.every((change) => change.revision === 1)).toBe(
			true,
		);
	});

	test("preserves payloads when a multi-write tombstones entities", async () => {
		const { database, repository } = await makeRepository();
		await repository.execute({
			type: "whiteboards.create",
			input: {
				value: {
					id: "board-delete",
					title: "Keep this in the tombstone",
					parentWhiteboardId: null,
				},
			},
		});
		await repository.execute({
			type: "whiteboards.archiveTree",
			input: {
				writes: [
					{
						entity: "whiteboard",
						operation: "delete",
						id: "board-delete",
						expectedRevision: 1,
					},
				],
			},
		});

		expect(await database.whiteboards.get("board-delete")).toMatchObject({
			title: "Keep this in the tombstone",
			deletedAt: expect.any(Number),
		});
		const batches = await repository.getPendingBatches(10);
		const batch = batches.at(-1);
		expect(batch?.changes.at(-1)?.value).toMatchObject({
			title: "Keep this in the tombstone",
			deletedAt: expect.any(Number),
		});
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
