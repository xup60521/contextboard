import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import {
	createContextboardDatabase,
	ensureLocalIdentity,
	type ContextboardDatabase,
} from "@contextboard/local-db";
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
});
