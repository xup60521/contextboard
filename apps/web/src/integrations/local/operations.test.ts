import "fake-indexeddb/auto";
import {
	type ContextboardDatabase,
	applyRemoteBatches,
	createContextboardDatabase,
	ensureLocalIdentity,
} from "@contextboard/local-db";
import {
	type ChangeBatch,
	parsePushChangesRequest,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { afterEach, describe, expect, test } from "vitest";
import { localMutation, localQuery } from "./operations";

const databases: ContextboardDatabase[] = [];
async function setup() {
	const db = createContextboardDatabase(`operations-${crypto.randomUUID()}`);
	databases.push(db);
	const identity = await ensureLocalIdentity(db);
	return { db, ...identity };
}
afterEach(async () => {
	await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("local operations", () => {
	test("creates nested whiteboards and cards with consistent counters", async () => {
		const { db, deviceId } = await setup();
		const root = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:root", x: 10, y: 20 },
		);
		const child = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{
				parentWhiteboardId: root.childWhiteboardId,
				shapeId: "shape:child",
				x: 30,
				y: 40,
			},
		);
		const card = await localMutation(db, deviceId, "canvas.createCardItem", {
			whiteboardId: child.childWhiteboardId,
			shapeId: "shape:card",
			x: 2,
			y: 3,
		});
		const board = await db.whiteboards.get(child.childWhiteboardId);
		const createdPlacement = await db.boardItems.get(card.itemId);
		expect(board).toMatchObject({
			parentWhiteboardId: root.childWhiteboardId,
			depth: 1,
			cardCount: 1,
		});
		expect(createdPlacement?.w).toBe(576);
		expect(
			await localQuery(db, "cards.get", { cardId: card.cardId }),
		).toMatchObject({
			card: {
				_id: card.cardId,
				activePlacementCount: 1,
				derivedTitle: "New card",
				content: {
					type: "doc",
					content: [
						{
							type: "heading",
							attrs: { level: 1 },
							content: [{ type: "text", text: "New card" }],
						},
					],
				},
			},
			boardWhiteboardId: child.childWhiteboardId,
			placements: [
				{ itemId: card.itemId, whiteboardId: child.childWhiteboardId },
			],
		});
		expect(await db.changeLog.count()).toBe(3);
	});

	test("appends idempotently and archives all active placements", async () => {
		const { db, deviceId } = await setup();
		const first = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:a", x: 0, y: 0 },
		);
		const second = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:b", x: 0, y: 0 },
		);
		const card = await localMutation(db, deviceId, "canvas.createCardItem", {
			whiteboardId: first.childWhiteboardId,
			shapeId: "shape:card",
			x: 0,
			y: 0,
		});
		const placed = await localMutation(
			db,
			deviceId,
			"cards.appendToWhiteboard",
			{ cardId: card.cardId, whiteboardId: second.childWhiteboardId },
		);
		const duplicate = await localMutation(
			db,
			deviceId,
			"cards.appendToWhiteboard",
			{ cardId: card.cardId, whiteboardId: second.childWhiteboardId },
		);
		expect(duplicate.itemId).toBe(placed.itemId);
		expect((await db.boardItems.get(placed.itemId))?.w).toBe(576);
		await localMutation(db, deviceId, "cards.archiveCard", {
			cardId: card.cardId,
		});
		expect(
			(await db.boardItems.where("cardId").equals(card.cardId).toArray()).every(
				(item) => item.archivedAt !== null,
			),
		).toBe(true);
		expect(
			await localQuery(db, "cards.get", { cardId: card.cardId }),
		).toBeNull();
	});

	test("copy-pastes a markdown card as another placement on the same board", async () => {
		const { db, deviceId } = await setup();
		const board = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:board", x: 0, y: 0 },
		);
		const card = await localMutation(db, deviceId, "canvas.createCardItem", {
			whiteboardId: board.childWhiteboardId,
			shapeId: "shape:original",
			x: 10,
			y: 20,
		});

		const pastedItemId = await localMutation(
			db,
			deviceId,
			"canvas.restoreOrAdoptCardItem",
			{
				whiteboardId: board.childWhiteboardId,
				shapeId: "shape:pasted",
				sourceCardId: card.cardId,
				x: 40,
				y: 50,
				w: 576,
				h: 180,
				rotation: 0,
			},
		);

		expect(pastedItemId).not.toBe(card.itemId);
		expect(await db.boardItems.get(pastedItemId)).toMatchObject({
			cardId: card.cardId,
			shapeId: "shape:pasted",
			whiteboardId: board.childWhiteboardId,
		});
		expect(await db.cards.get(card.cardId)).toMatchObject({
			activePlacementCount: 2,
		});
		expect(await db.whiteboards.get(board.childWhiteboardId)).toMatchObject({
			cardCount: 2,
		});
	});

	test("adopts markdown content from a stale clipboard card", async () => {
		const { db, deviceId } = await setup();
		const board = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:board", x: 0, y: 0 },
		);
		const content = {
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 2 },
					content: [{ type: "text", text: "Clipboard heading" }],
				},
			],
		};

		const itemId = await localMutation(
			db,
			deviceId,
			"canvas.restoreOrAdoptCardItem",
			{
				whiteboardId: board.childWhiteboardId,
				shapeId: "shape:pasted-stale",
				sourceCardId: "missing-card",
				content: JSON.stringify(content),
				x: 0,
				y: 0,
				w: 576,
				h: 180,
				rotation: 0,
			},
		);
		const item = await db.boardItems.get(itemId);
		expect(item?.cardId).toBeTruthy();
		expect(await db.cards.get(item?.cardId ?? "")).toMatchObject({
			content,
			derivedTitle: "Clipboard heading",
			activePlacementCount: 1,
		});
	});

	test("preserves the card query contract, metadata rows, and content versions", async () => {
		const { db, deviceId } = await setup();
		const board = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:board", x: 0, y: 0 },
		);
		const card = await localMutation(db, deviceId, "canvas.createCardItem", {
			whiteboardId: board.childWhiteboardId,
			shapeId: "shape:card",
			x: 0,
			y: 0,
		});
		const content = {
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "First row" }] },
				{ type: "paragraph", content: [{ type: "text", text: "Second row" }] },
			],
		};

		await expect(
			localMutation(db, deviceId, "cards.updateContent", {
				cardId: card.cardId,
				content,
				expectedVersion: 99,
			}),
		).rejects.toThrow("updated elsewhere");
		await expect(
			localMutation(db, deviceId, "cards.updateContent", {
				cardId: card.cardId,
				content,
				expectedVersion: 1,
			}),
		).resolves.toBe(2);
		await expect(
			localMutation(db, deviceId, "cards.updateContent", {
				cardId: card.cardId,
				content,
				expectedVersion: 2,
			}),
		).resolves.toBe(2);
		expect(
			await localQuery(db, "cards.get", { cardId: card.cardId }),
		).toMatchObject({
			card: {
				derivedTitle: "First row",
				plainText: "First row\nSecond row",
				version: 2,
			},
		});
	});

	test("guards tldraw revisions including the root document", async () => {
		const { db, deviceId } = await setup();
		expect(
			await localMutation(db, deviceId, "tldrawDocuments.save", {
				whiteboardId: null,
				snapshot: { store: {} },
			}),
		).toMatchObject({ revision: 1 });
		await expect(
			localMutation(db, deviceId, "tldrawDocuments.save", {
				whiteboardId: null,
				snapshot: {},
				expectedRevision: 0,
			}),
		).rejects.toThrow("updated elsewhere");
		expect(
			await localQuery(db, "tldrawDocuments.get", { whiteboardId: null }),
		).toMatchObject({ revision: 1 });
	});

	test("migrates a legacy snapshot to record-level canvas persistence", async () => {
		const { db, deviceId } = await setup();
		const board = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:board" },
		);
		await localMutation(db, deviceId, "tldrawDocuments.save", {
			whiteboardId: board.childWhiteboardId,
			snapshot: {
				schema: { schemaVersion: 2, sequences: {} },
				store: {
					"shape:legacy": {
						id: "shape:legacy",
						typeName: "shape",
						type: "geo",
					},
					"shape:managed": {
						id: "shape:managed",
						typeName: "shape",
						type: "markdown-card",
					},
				},
			},
		});
		await localMutation(db, deviceId, "canvas.applyRecordChanges", {
			whiteboardId: board.childWhiteboardId,
			added: [{ id: "shape:new", typeName: "shape", type: "arrow" }],
			updated: [],
			removed: [],
		});
		const records = await db.canvasRecords
			.where("whiteboardId")
			.equals(board.childWhiteboardId)
			.toArray();
		expect(records.map((record) => record.recordId).sort()).toEqual([
			"shape:legacy",
			"shape:new",
		]);
		const batches = await db.changeLog.toArray();
		expect(JSON.stringify(batches)).not.toContain('"snapshot"');
	});

	test("creates, lists, orders, archives, and audits card relations separately from references", async () => {
		const { db, deviceId } = await setup();
		const board = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:board" },
		);
		const first = await localMutation(
			db,
			deviceId,
			"canvas.createCardItem",
			{
				whiteboardId: board.childWhiteboardId,
				shapeId: "shape:first",
			},
		);
		const second = await localMutation(
			db,
			deviceId,
			"canvas.createCardItem",
			{
				whiteboardId: board.childWhiteboardId,
				shapeId: "shape:second",
			},
		);
		const relationId = await localMutation(
			db,
			deviceId,
			"relations.create",
			{
				whiteboardId: board.childWhiteboardId,
				sourceCardId: first.cardId,
				targetCardId: second.cardId,
				relation: "supports",
				ordinal: 2,
			},
		);
		const relations = await localQuery(db, "relations.list", {
			cardId: first.cardId,
			whiteboardId: board.childWhiteboardId,
		});
		expect(relations).toHaveLength(1);
		expect(relations[0]).toMatchObject({
			_id: relationId,
			relation: "supports",
			ordinal: 2,
		});
		expect(relations[0].clock).toMatch(
			new RegExp(`${deviceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
		);
		expect(await db.cardReferences.count()).toBe(0);
		expect(
			(await db.changeLog.toArray()).some((batch) =>
				batch.changes.some(
					(change) =>
						change.entityType === "cardRelation" &&
						change.entityId === relationId,
				),
			),
		).toBe(true);

		await localMutation(db, deviceId, "relations.archive", { relationId });
		expect(
			await localQuery(db, "relations.list", { cardId: first.cardId }),
		).toEqual([]);
		expect((await db.cardRelations.get(relationId))?.deletedAt).not.toBeNull();
	});

	test.each(["keep-local", "keep-remote", "keep-both"] as const)(
		"resolves a Markdown conflict with a syncable %s domain batch",
		async (resolution) => {
			const { db, deviceId, workspaceId } = await setup();
			const board = await localMutation(
				db,
				deviceId,
				"canvas.createSubwhiteboardItem",
				{ parentWhiteboardId: null, shapeId: "shape:board" },
			);
			const created = await localMutation(
				db,
				deviceId,
				"canvas.createCardItem",
				{
					whiteboardId: board.childWhiteboardId,
					shapeId: "shape:card",
				},
			);
			const localCard = await db.cards.get(created.cardId);
			if (!localCard) throw new Error("Expected local card");
			await db.changeLog.clear();
			const remoteContent = {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "Remote content" }],
					},
				],
			};
			const remoteCard = {
				...localCard,
				content: remoteContent,
				derivedTitle: "Remote content",
				plainText: "Remote content",
				preview: "Remote content",
				contentVersion: localCard.contentVersion + 1,
				revision: localCard.revision + 1,
				updatedAt: localCard.updatedAt + 1,
				updatedByDeviceId: "device-remote",
			};
			const remote: ChangeBatch = {
				protocolVersion: SYNC_PROTOCOL_VERSION,
				schemaVersion: SYNC_SCHEMA_VERSION,
				changeId: `remote-${resolution}`,
				workspaceId,
				deviceId: "device-remote",
				deviceSequence: 1,
				clock: "0000000000002:000000:device-remote",
				command: "cards.updateContent",
				createdAt: 2,
				changes: [
					{
						entityType: "card",
						entityId: localCard.id,
						baseRevision: Math.max(0, localCard.revision - 1),
						revision: remoteCard.revision,
						operation: "upsert",
						clock: "0000000000002:000000:device-remote",
						value: remoteCard,
					},
				],
			};
			await applyRemoteBatches(db, [remote], "cloud", "1");
			const conflict = (await db.conflicts.toArray())[0];
			if (!conflict) throw new Error("Expected conflict");
			const copyId = `card:${conflict.conflictId}`;

			await localMutation(db, deviceId, "conflicts.resolve", {
				conflictId: conflict.conflictId,
				resolution,
			});
			const resolutionBatch = (await db.changeLog.toArray()).find(
				(batch) => batch.command === "conflicts.resolve",
			);
			expect(resolutionBatch).toBeDefined();
			const changedTypes = new Set(
				resolutionBatch?.changes.map((change) => change.entityType),
			);
			expect(changedTypes.has("card")).toBe(true);
			expect(changedTypes.has("conflict")).toBe(true);
			expect(
				resolutionBatch?.changes.some(
					(change) => change.entityId === copyId,
				),
			).toBe(true);
			expect((await db.conflicts.get(conflict.conflictId))?.resolution).toBe(
				resolution,
			);
			const original = await db.cards.get(localCard.id);
			expect(original?.content).toEqual(
				resolution === "keep-remote" ? remoteContent : localCard.content,
			);
			expect((await db.cards.get(copyId))?.archivedAt === null).toBe(
				resolution === "keep-both",
			);
		},
	);

	test("produces transport-valid post-state batches for local operations", async () => {
		const { db, deviceId, workspaceId } = await setup();
		const board = await localMutation(
			db,
			deviceId,
			"canvas.createSubwhiteboardItem",
			{ parentWhiteboardId: null, shapeId: "shape:board" },
		);
		await localMutation(db, deviceId, "canvas.applyRecordChanges", {
			whiteboardId: board.childWhiteboardId,
			added: [{ id: "shape:arrow", typeName: "shape", type: "arrow" }],
			updated: [],
			removed: [],
		});
		const batches = await db.changeLog.toArray();
		expect(() =>
			parsePushChangesRequest({ workspaceId, batches, cursor: null }),
		).not.toThrow();
		expect(JSON.stringify(batches)).not.toContain('"blob"');
		expect(JSON.stringify(batches)).not.toContain('"snapshot"');
	});
});
