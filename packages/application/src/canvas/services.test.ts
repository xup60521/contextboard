import { describe, expect, test } from "vitest";
import { createRepositoryCardsService } from "../cards/repository-cards-service";
import { createMemoryWorkspaceRepository } from "../testing";
import {
	createRepositoryCanvasService,
	createRepositoryWhiteboardsService,
} from "./services";

function setup() {
	let clock = 1_000;
	let counter = 0;
	const repository = createMemoryWorkspaceRepository({ now: () => ++clock });
	const options = {
		now: () => ++clock,
		createId: () => `id-${++counter}`,
		deviceId: "device-1",
	};
	return {
		repository,
		cards: createRepositoryCardsService(repository, options),
		whiteboards: createRepositoryWhiteboardsService(repository, options),
		canvas: createRepositoryCanvasService(repository, options),
	};
}

describe("repository whiteboards capability", () => {
	test("creates a root board, renames it and reads it back with counts", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		await canvas.createCardItem({ whiteboardId: rootId, shapeId: "shape:a" });
		await whiteboards.createSubwhiteboard({
			parentWhiteboardId: rootId,
			shapeId: "shape:b",
		});

		expect(await whiteboards.rename({ whiteboardId: rootId, title: "  My   board  " })).toBe(
			"My board",
		);
		const detail = await whiteboards.get(rootId);
		expect(detail?.title).toBe("My board");
		expect(detail?.cardCount).toBe(1);
		expect(detail?.childWhiteboardCount).toBe(1);
		expect(detail?.breadcrumbs).toEqual([{ id: rootId, title: "My board" }]);
	});

	test("derives child hierarchy and breadcrumbs for a subwhiteboard", async () => {
		const { whiteboards } = setup();
		const rootId = await whiteboards.createRoot();
		const { childWhiteboardId } = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: rootId,
			shapeId: "shape:child",
		});
		const child = await whiteboards.get(childWhiteboardId);
		expect(child?.depth).toBe(1);
		expect(child?.parentWhiteboardId).toBe(rootId);
		expect(child?.breadcrumbs.map((entry) => entry.id)).toEqual([
			rootId,
			childWhiteboardId,
		]);
	});

	test("archiving a board removes it from every read path", async () => {
		const { whiteboards } = setup();
		const rootId = await whiteboards.createRoot();
		await whiteboards.archive(rootId);
		expect(await whiteboards.get(rootId)).toBeNull();
		expect(await whiteboards.list()).toEqual([]);
	});
});

describe("repository canvas capability", () => {
	test("creates a card item that is visible to both the canvas and the card list", async () => {
		const { whiteboards, canvas, cards } = setup();
		const rootId = await whiteboards.createRoot();
		const { cardId, itemId } = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:card",
			x: 10,
			y: 20,
		});
		const items = await canvas.listItems(rootId);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: itemId,
			kind: "card",
			cardId,
			shapeId: "shape:card",
			x: 10,
			y: 20,
			w: 576,
		});
		expect(items[0]?.card?.title).toBe("New card");
		const detail = await cards.get(cardId);
		expect(detail?.placements.map((row) => row.itemId)).toEqual([itemId]);
		expect(detail?.boardWhiteboardId).toBe(rootId);
		expect(detail?.breadcrumbs).toHaveLength(1);
	});

	test("moves an item with an expected revision and archives it", async () => {
		const { whiteboards, canvas, cards } = setup();
		const rootId = await whiteboards.createRoot();
		const { itemId, cardId } = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:card",
		});
		await canvas.updateItemFrame({
			itemId,
			x: 100,
			y: 200,
			w: 300,
			h: 400,
			rotation: 0,
			zIndex: 5,
		});
		expect((await canvas.listItems(rootId))[0]).toMatchObject({
			x: 100,
			y: 200,
			w: 300,
			h: 400,
			zIndex: 5,
		});

		await canvas.archiveItem({ itemId });
		expect(await canvas.listItems(rootId)).toEqual([]);
		// The card survives its placement and becomes an orphan.
		const detail = await cards.get(cardId);
		expect(detail?.activePlacementCount).toBe(0);
		expect(detail?.placements).toEqual([]);
	});

	test("restoreOrAdoptCardItem is idempotent for a shape that already exists", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		const { itemId } = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:card",
		});
		expect(
			await canvas.restoreOrAdoptCardItem({
				whiteboardId: rootId,
				shapeId: "shape:card",
			}),
		).toBe(itemId);
		expect(await canvas.listItems(rootId)).toHaveLength(1);
	});

	test("adopts a pasted shape into a brand new card", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		const itemId = await canvas.restoreOrAdoptCardItem({
			whiteboardId: rootId,
			shapeId: "shape:pasted",
		});
		expect(itemId).toBeTruthy();
		const items = await canvas.listItems(rootId);
		expect(items).toHaveLength(1);
		expect(items[0]?.shapeId).toBe("shape:pasted");
	});

	test("saves and reloads a tldraw snapshot, rejecting a stale revision", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		expect(await canvas.getDocument(rootId)).toBeNull();

		const first = await canvas.saveDocument({
			whiteboardId: rootId,
			snapshot: { store: {}, schema: null },
		});
		expect(first.revision).toBe(1);
		const second = await canvas.saveDocument({
			whiteboardId: rootId,
			snapshot: { store: { a: 1 }, schema: null },
			expectedRevision: 1,
		});
		expect(second.revision).toBe(2);

		const document = await canvas.getDocument(rootId);
		expect(document?.revision).toBe(2);
		expect(document?.snapshot).toEqual({ store: { a: 1 }, schema: null });

		await expect(
			canvas.saveDocument({
				whiteboardId: rootId,
				snapshot: {},
				expectedRevision: 1,
			}),
		).rejects.toThrow("Tldraw document was updated elsewhere");
	});

	test("keeps root and per-board documents separate", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		await canvas.saveDocument({ whiteboardId: null, snapshot: { root: true } });
		await canvas.saveDocument({
			whiteboardId: rootId,
			snapshot: { root: false },
		});
		expect((await canvas.getDocument(null))?.snapshot).toEqual({ root: true });
		expect((await canvas.getDocument(rootId))?.snapshot).toEqual({
			root: false,
		});
	});
});
