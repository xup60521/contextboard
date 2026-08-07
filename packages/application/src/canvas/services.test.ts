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
		workspaceId: "workspace-1",
	};
	return {
		repository,
		workspaceId: options.workspaceId,
		cards: createRepositoryCardsService(repository, options),
		whiteboards: createRepositoryWhiteboardsService(repository, options),
		canvas: createRepositoryCanvasService(repository, options),
	};
}

describe("repository whiteboards capability", () => {
	test("creates a top-level subwhiteboard link on the virtual root", async () => {
		const { whiteboards, canvas } = setup();
		const created = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: null,
			shapeId: "shape:top-level",
		});

		expect(await whiteboards.get(created.childWhiteboardId)).toMatchObject({
			parentWhiteboardId: null,
			depth: 0,
		});
		expect(await canvas.listItems(null)).toContainEqual(
			expect.objectContaining({
				id: created.itemId,
				whiteboardId: null,
				kind: "subwhiteboard",
				childWhiteboardId: created.childWhiteboardId,
				shapeId: "shape:top-level",
			}),
		);
	});

	test("rejects a missing parent without writing a board or link", async () => {
		const { whiteboards, canvas } = setup();

		await expect(
			whiteboards.createSubwhiteboard({
				parentWhiteboardId: "missing-parent",
				shapeId: "shape:orphan",
			}),
		).rejects.toThrow(/Whiteboard not found: missing-parent/);
		expect(await whiteboards.list()).toEqual([]);
		expect(await canvas.listItems(null)).toEqual([]);
	});

	test("creates a root board, renames it and reads it back with counts", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		await canvas.createCardItem({ whiteboardId: rootId, shapeId: "shape:a" });
		await whiteboards.createSubwhiteboard({
			parentWhiteboardId: rootId,
			shapeId: "shape:b",
		});

		expect(
			await whiteboards.rename({
				whiteboardId: rootId,
				title: "  My   board  ",
			}),
		).toBe("My board");
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

	test("archives a whiteboard tree and removes its parent links", async () => {
		const { whiteboards, canvas, cards } = setup();
		const parentId = await whiteboards.createRoot();
		const child = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: parentId,
			shapeId: "shape:child",
		});
		const grandchild = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: child.childWhiteboardId,
			shapeId: "shape:grandchild",
		});
		const sibling = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: parentId,
			shapeId: "shape:sibling",
		});
		const cardId = await cards.create();
		await cards.appendToWhiteboard({
			cardId,
			whiteboardId: grandchild.childWhiteboardId,
		});
		await whiteboards.archive(child.childWhiteboardId);

		expect(await whiteboards.get(child.childWhiteboardId)).toBeNull();
		expect(await whiteboards.get(grandchild.childWhiteboardId)).toBeNull();
		expect(await whiteboards.get(sibling.childWhiteboardId)).not.toBeNull();
		expect(
			(await canvas.listItems(parentId)).map((item) => item.childWhiteboardId),
		).toEqual([sibling.childWhiteboardId]);
		expect((await cards.get(cardId))?.activePlacementCount).toBe(0);
	});

	test("deleting a subwhiteboard link uses the same cascade", async () => {
		const { whiteboards, canvas } = setup();
		const parentId = await whiteboards.createRoot();
		const child = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: parentId,
			shapeId: "shape:child",
		});
		await whiteboards.createSubwhiteboard({
			parentWhiteboardId: child.childWhiteboardId,
			shapeId: "shape:grandchild",
		});

		await canvas.archiveItem({ itemId: child.itemId, deleteCards: false });

		expect(await whiteboards.get(child.childWhiteboardId)).toBeNull();
		expect(await canvas.listItems(parentId)).toEqual([]);
	});

	test("archive options delete cards only after their final placement", async () => {
		const { whiteboards, canvas, cards } = setup();
		const parentId = await whiteboards.createRoot();
		const child = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: parentId,
			shapeId: "shape:child",
		});
		const cardId = await cards.create();
		await cards.appendToWhiteboard({
			cardId,
			whiteboardId: child.childWhiteboardId,
		});

		await whiteboards.archive(child.childWhiteboardId, { deleteCards: true });

		expect(await cards.get(cardId)).toBeNull();
		expect(await canvas.listItems(parentId)).toEqual([]);
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
	test("does not hydrate unrelated board items, cards, records or documents", async () => {
		const { whiteboards, canvas, repository } = setup();
		const boardId = await whiteboards.createRoot();
		const otherBoardId = await whiteboards.createRoot();
		await canvas.createCardItem({
			whiteboardId: boardId,
			shapeId: "shape:board",
		});
		await canvas.createCardItem({
			whiteboardId: otherBoardId,
			shapeId: "shape:other",
		});
		await canvas.saveDocument({
			whiteboardId: otherBoardId,
			snapshot: { unrelated: true },
		});
		await canvas.applyRecordChanges({
			whiteboardId: otherBoardId,
			added: [{ id: "shape:other-record", typeName: "shape" }],
			updated: [],
			removed: [],
		});

		const itemQueries: Array<{ type: string; input?: unknown }> = [];
		const originalQuery = repository.query.bind(repository);
		repository.query = async (query) => {
			itemQueries.push(query);
			return originalQuery(query);
		};

		expect(
			(await canvas.listItems(boardId)).map((item) => item.shapeId),
		).toEqual(["shape:board"]);
		expect(await canvas.getDocument(boardId)).toBeNull();
		expect(
			itemQueries.some(
				(query) =>
					query.type === "items.list" &&
					(query.input as { whiteboardId?: string }).whiteboardId === boardId,
			),
		).toBe(true);
		expect(
			itemQueries.some(
				(query) =>
					query.type === "items.list" &&
					(query.input as { whiteboardId?: string }).whiteboardId ===
						otherBoardId,
			),
		).toBe(false);
	});

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

	test("updates multiple item frames with one atomic repository command", async () => {
		const { whiteboards, canvas, repository } = setup();
		const rootId = await whiteboards.createRoot();
		const first = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:first",
		});
		const second = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:second",
		});
		const commandCount = repository.pendingCommands.length;

		await canvas.updateItemFrames({
			updates: [
				{
					itemId: first.itemId,
					x: 100,
					y: 200,
					w: 300,
					h: 400,
					rotation: 0.1,
					zIndex: 5,
				},
				{
					itemId: second.itemId,
					x: 500,
					y: 600,
					w: 700,
					h: 800,
					rotation: 0.2,
					zIndex: 6,
				},
			],
		});

		expect(repository.pendingCommands.slice(commandCount)).toEqual([
			"items.update",
		]);
		expect(await canvas.listItems(rootId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: first.itemId,
					x: 100,
					y: 200,
					w: 300,
					h: 400,
					rotation: 0.1,
					zIndex: 5,
				}),
				expect.objectContaining({
					id: second.itemId,
					x: 500,
					y: 600,
					w: 700,
					h: 800,
					rotation: 0.2,
					zIndex: 6,
				}),
			]),
		);
	});

	test("rejects duplicate item ids before issuing a write", async () => {
		const { whiteboards, canvas, repository } = setup();
		const rootId = await whiteboards.createRoot();
		const { itemId } = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:duplicate",
		});
		const commandCount = repository.pendingCommands.length;
		const update = {
			itemId,
			x: 1,
			y: 2,
			w: 3,
			h: 4,
			rotation: 0,
			zIndex: 5,
		};

		await expect(
			canvas.updateItemFrames({ updates: [update, update] }),
		).rejects.toThrow(/same item twice/);
		expect(repository.pendingCommands.length).toBe(commandCount);
	});

	test("keeps a stale multi-write frame command atomic", async () => {
		const { whiteboards, canvas, repository } = setup();
		const rootId = await whiteboards.createRoot();
		const first = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:atomic-first",
		});
		const second = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:atomic-second",
		});
		const firstRow = await repository.query<Record<string, unknown> | null>({
			type: "items.get",
			input: { id: first.itemId },
		});
		const secondRow = await repository.query<Record<string, unknown> | null>({
			type: "items.get",
			input: { id: second.itemId },
		});
		if (!firstRow || !secondRow) throw new Error("expected both items");

		await expect(
			repository.execute({
				type: "items.update",
				input: {
					writes: [
						{
							entity: "boardItem",
							operation: "upsert",
							id: first.itemId,
							value: { ...firstRow, x: 111 },
							expectedRevision: Number(firstRow.revision),
						},
						{
							entity: "boardItem",
							operation: "upsert",
							id: second.itemId,
							value: { ...secondRow, x: 222 },
							expectedRevision: Number(secondRow.revision) + 1,
						},
					],
				},
			}),
		).rejects.toThrow(/CONFLICT/);

		expect(await canvas.listItems(rootId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: first.itemId, x: 0 }),
				expect.objectContaining({ id: second.itemId, x: 0 }),
			]),
		);
	});

	test("archiveItem without deleteCards detaches the placement and keeps the card", async () => {
		const { whiteboards, canvas, cards } = setup();
		const rootId = await whiteboards.createRoot();
		const child = await whiteboards.createSubwhiteboard({
			parentWhiteboardId: rootId,
			shapeId: "shape:child",
		});
		const { itemId, cardId } = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:card",
		});
		await cards.appendToWhiteboard({
			cardId,
			whiteboardId: child.childWhiteboardId,
		});

		// Detaching one of two placements leaves the card on the other board.
		await canvas.archiveItem({ itemId, deleteCards: false });
		const afterFirst = await cards.get(cardId);
		expect(afterFirst).not.toBeNull();
		expect(afterFirst?.activePlacementCount).toBe(1);
		expect(await canvas.listItems(rootId)).toHaveLength(1);
		expect(await canvas.listItems(child.childWhiteboardId)).toHaveLength(1);

		// Detaching the final placement leaves the card alive as an orphan.
		const lastItemId = (await canvas.listItems(child.childWhiteboardId))[0]?.id;
		if (!lastItemId) throw new Error("expected a placement on the child board");
		await canvas.archiveItem({ itemId: lastItemId, deleteCards: false });
		const afterLast = await cards.get(cardId);
		expect(afterLast).not.toBeNull();
		expect(afterLast?.activePlacementCount).toBe(0);
		expect(afterLast?.placements).toEqual([]);
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

	test("links a trusted same-workspace paste to the source card", async () => {
		const { whiteboards, canvas, cards, workspaceId } = setup();
		const rootId = await whiteboards.createRoot();
		const content = {
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Linked" }] },
			],
		};
		const source = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:source",
			content,
		});

		await canvas.restoreOrAdoptCardItem({
			whiteboardId: rootId,
			shapeId: "shape:linked",
			sourceCardId: source.cardId,
			sourceWorkspaceId: workspaceId,
			placement: "link",
			content,
		});

		const linked = (await canvas.listItems(rootId)).find(
			(item) => item.shapeId === "shape:linked",
		);
		expect(linked?.cardId).toBe(source.cardId);
		expect((await cards.get(source.cardId))?.activePlacementCount).toBe(2);
	});

	test("duplicates explicitly even when the source is trusted", async () => {
		const { whiteboards, canvas, cards, workspaceId } = setup();
		const rootId = await whiteboards.createRoot();
		const content = {
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Copy" }] },
			],
		};
		const source = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:source",
			content,
		});

		await canvas.restoreOrAdoptCardItem({
			whiteboardId: rootId,
			shapeId: "shape:duplicate",
			sourceCardId: source.cardId,
			sourceWorkspaceId: workspaceId,
			placement: "duplicate",
			content,
		});

		const duplicate = (await canvas.listItems(rootId)).find(
			(item) => item.shapeId === "shape:duplicate",
		);
		expect(duplicate?.cardId).toBeTruthy();
		expect(duplicate?.cardId).not.toBe(source.cardId);
		expect((await cards.get(duplicate!.cardId!))?.content).toEqual(content);
		expect((await cards.get(source.cardId))?.activePlacementCount).toBe(1);
	});

	test("does not trust a colliding external card id", async () => {
		const { whiteboards, canvas, cards } = setup();
		const rootId = await whiteboards.createRoot();
		const source = await canvas.createCardItem({
			whiteboardId: rootId,
			shapeId: "shape:source",
			content: {
				type: "doc",
				content: [
					{ type: "paragraph", content: [{ type: "text", text: "Original" }] },
				],
			},
		});
		const externalContent = {
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "External" }] },
			],
		};

		await canvas.restoreOrAdoptCardItem({
			whiteboardId: rootId,
			shapeId: "shape:external",
			sourceCardId: source.cardId,
			sourceWorkspaceId: "different-workspace",
			content: externalContent,
		});

		const external = (await canvas.listItems(rootId)).find(
			(item) => item.shapeId === "shape:external",
		);
		expect(external?.cardId).toBeTruthy();
		expect(external?.cardId).not.toBe(source.cardId);
		expect((await cards.get(source.cardId))?.title).toBe("Original");
		expect((await cards.get(source.cardId))?.activePlacementCount).toBe(1);
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

describe("repository canvas record changes", () => {
	test("persists a drawing delta, echoes revisions and rebuilds the store", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();

		const first = await canvas.applyRecordChanges({
			whiteboardId: rootId,
			added: [
				{ id: "shape:a", typeName: "shape", x: 1 },
				{ id: "shape:b", typeName: "shape", x: 2 },
			],
			updated: [],
			removed: [],
		});
		expect(first.versions).toEqual({ "shape:a": 1, "shape:b": 1 });

		const second = await canvas.applyRecordChanges({
			whiteboardId: rootId,
			added: [],
			updated: [{ id: "shape:a", typeName: "shape", x: 9 }],
			removed: ["shape:b"],
		});
		// Removals carry no echo expectation; tombstones are invisible to `list`.
		expect(second.versions).toEqual({ "shape:a": 2 });

		const document = await canvas.getDocument(rootId);
		expect(document?.snapshot).toEqual({
			schema: null,
			store: { "shape:a": { id: "shape:a", typeName: "shape", x: 9 } },
		});
		expect(document?.canvasRecordVersions).toEqual({ "shape:a": 2 });
	});

	test("does not resurrect a legacy snapshot after deleting the last record", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		await canvas.saveDocument({
			whiteboardId: rootId,
			snapshot: {
				store: {
					"shape:legacy": {
						id: "shape:legacy",
						typeName: "shape",
						type: "geo",
					},
				},
			},
		});
		await canvas.applyRecordChanges({
			whiteboardId: rootId,
			added: [{ id: "shape:only", typeName: "shape", type: "geo" }],
			updated: [],
			removed: [],
		});
		await canvas.applyRecordChanges({
			whiteboardId: rootId,
			added: [],
			updated: [],
			removed: ["shape:legacy", "shape:only"],
		});

		expect((await canvas.getDocument(rootId))?.snapshot).toEqual({
			schema: null,
			store: {},
		});
	});

	test("atomically migrates the legacy snapshot before applying a record delta", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		await canvas.saveDocument({
			whiteboardId: rootId,
			snapshot: {
				schema: { schemaVersion: 2 },
				store: {
					"shape:old": {
						id: "shape:old",
						typeName: "shape",
						type: "geo",
					},
					"shape:card": {
						id: "shape:card",
						typeName: "shape",
						type: "markdown-card",
					},
				},
			},
		});
		await canvas.applyRecordChanges({
			whiteboardId: rootId,
			added: [{ id: "shape:new", typeName: "shape" }],
			updated: [],
			removed: [],
		});

		const document = await canvas.getDocument(rootId);
		expect(document?.snapshot).toEqual({
			schema: { schemaVersion: 2 },
			store: {
				"shape:old": {
					id: "shape:old",
					typeName: "shape",
					type: "geo",
				},
				"shape:new": { id: "shape:new", typeName: "shape" },
			},
		});
	});

	test("migrates legacy boards larger than the former command cap", async () => {
		const { whiteboards, canvas } = setup();
		const rootId = await whiteboards.createRoot();
		const store = Object.fromEntries(
			Array.from({ length: 205 }, (_, index) => {
				const id = `shape:${index}`;
				return [id, { id, typeName: "shape", type: "geo" }];
			}),
		);
		await canvas.saveDocument({
			whiteboardId: rootId,
			snapshot: { schema: { schemaVersion: 2 }, store },
		});
		await canvas.applyRecordChanges({
			whiteboardId: rootId,
			added: [{ id: "shape:new", typeName: "shape" }],
			updated: [],
			removed: [],
		});
		const document = await canvas.getDocument(rootId);
		expect(
			Object.keys(
				(document?.snapshot as { store: Record<string, unknown> }).store,
			),
		).toHaveLength(206);
	});

	test("rejects record changes without a whiteboard", async () => {
		const { canvas } = setup();
		await expect(
			canvas.applyRecordChanges({
				whiteboardId: null,
				added: [],
				updated: [],
				removed: [],
			}),
		).rejects.toThrow("Canvas records require a whiteboard");
	});
});

describe("pasted card content", () => {
	test("parses the canvas's serialized props instead of storing the string", async () => {
		// A pasted or duplicated shape hands over `shape.props.content`, which is
		// a JSON string. Storing it verbatim double-encodes the document: the
		// card then renders blank and its editor shows the raw config as text.
		const { whiteboards, canvas, cards } = setup();
		const boardId = await whiteboards.createRoot();
		const document = {
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "皮克斯規劃" }],
				},
			],
		};

		await canvas.restoreOrAdoptCardItem({
			whiteboardId: boardId,
			shapeId: "shape:pasted",
			content: JSON.stringify(document),
		});

		const [item] = await canvas.listItems(boardId);
		const detail = await cards.get(item!.cardId!);
		expect(detail?.content).toEqual(document);
		expect(typeof detail?.content).not.toBe("string");
		// The derived metadata proves the document was understood, not stored raw.
		expect(detail?.title).toBe("皮克斯規劃");
	});

	test("falls back to a new card when the serialized props are unusable", async () => {
		const { whiteboards, canvas, cards } = setup();
		const boardId = await whiteboards.createRoot();

		await canvas.restoreOrAdoptCardItem({
			whiteboardId: boardId,
			shapeId: "shape:broken",
			content: "not json at all",
		});

		const [item] = await canvas.listItems(boardId);
		const detail = await cards.get(item!.cardId!);
		expect(detail?.title).toBe("New card");
	});

	test("still accepts an already-parsed document", async () => {
		const { whiteboards, canvas, cards } = setup();
		const boardId = await whiteboards.createRoot();
		const document = {
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "Direct" }],
				},
			],
		};

		await canvas.restoreOrAdoptCardItem({
			whiteboardId: boardId,
			shapeId: "shape:direct",
			content: document,
		});

		const [item] = await canvas.listItems(boardId);
		expect((await cards.get(item!.cardId!))?.content).toEqual(document);
	});
});
