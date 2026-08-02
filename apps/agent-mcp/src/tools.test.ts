import "fake-indexeddb/auto";
import {
	createRepositoryCanvasService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application/canvas";
import { createRepositoryCardsService } from "@contextboard/application/cards";
import { createRepositoryCardRelationsService } from "@contextboard/application/relations";
import {
	createContextboardDatabase,
	IndexedDbWorkspaceRepository,
} from "@contextboard/storage-indexeddb";
import { afterEach, describe, expect, test } from "vitest";
import { resolveBridgePort } from "./index";
import { createTools, type ToolDefinition } from "./tools";

const databases: Array<ReturnType<typeof createContextboardDatabase>> = [];
const WORKSPACE_ID = "workspace-under-test";

/** The part of a tldraw arrow binding these tests assert on. */
type ArrowBinding = {
	toId: string;
	fromId: string;
	props: { terminal: "start" | "end" };
};

function makeTools() {
	const database = createContextboardDatabase(crypto.randomUUID());
	databases.push(database);
	const repository = new IndexedDbWorkspaceRepository(database);
	const options = { workspaceId: WORKSPACE_ID };
	const canvas = createRepositoryCanvasService(repository, options);
	const tools = createTools({
		cards: createRepositoryCardsService(repository),
		whiteboards: createRepositoryWhiteboardsService(repository, options),
		canvas,
		relations: createRepositoryCardRelationsService(repository),
	});
	const byName = new Map<string, ToolDefinition>(
		tools.map((tool) => [tool.name, tool]),
	);
	// Tool results are JSON shaped by the services under test, so assertions
	// read them structurally rather than restating every service type here.
	// biome-ignore lint/suspicious/noExplicitAny: test-only result shim
	const call = async <T = any>(
		name: string,
		input: Record<string, unknown> = {},
	): Promise<T> => {
		const tool = byName.get(name);
		if (!tool) throw new Error(`missing tool ${name}`);
		return (await tool.handler(input)) as T;
	};
	/** The raw tldraw store for a board, to assert on arrows and bindings. */
	const store = async (whiteboardId: string) => {
		const document = await canvas.getDocument(whiteboardId);
		return ((document?.snapshot as { store?: Record<string, unknown> } | null)
			?.store ?? {}) as Record<string, Record<string, unknown>>;
	};
	return { call, tools, store };
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("tool surface", () => {
	test("every tool has a description and an object schema", () => {
		const { tools } = makeTools();
		expect(tools.length).toBeGreaterThan(0);
		for (const tool of tools) {
			expect(tool.name).toMatch(/^[a-z_]+$/);
			expect(tool.description.length).toBeGreaterThan(30);
			expect(tool.inputSchema).toMatchObject({ type: "object" });
		}
	});

	test("tool names are unique", () => {
		const { tools } = makeTools();
		expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
	});
});

describe("whiteboards and cards", () => {
	test("creates a titled whiteboard and lists it", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {
			title: "Rate limiting",
		});
		expect(whiteboardId).toBeTruthy();
		const boards =
			await call<Array<{ id: string; title: string }>>("list_whiteboards");
		expect(boards.find((board) => board.id === whiteboardId)?.title).toBe(
			"Rate limiting",
		);
	});

	test("nests a sub-whiteboard under its parent", async () => {
		const { call } = makeTools();
		const parent = await call("create_whiteboard", { title: "Parent" });
		const child = await call("create_whiteboard", {
			title: "Child",
			parentWhiteboardId: parent.whiteboardId,
		});
		const detail = await call("get_whiteboard", {
			whiteboardId: child.whiteboardId,
		});
		expect(detail.parentWhiteboardId).toBe(parent.whiteboardId);
		expect(child.itemId).toBeTruthy();
	});

	test("creates a card, placing it and deriving its title from line one", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {
			title: "Board",
		});
		const { cardId, placement } = await call("create_card", {
			text: "Token buckets leak\nThe refill rate dominates burst size.",
			whiteboardId,
		});
		expect(placement.whiteboardId).toBe(whiteboardId);
		const card = await call("get_card", { cardId });
		expect(card.title).toBe("Token buckets leak");
		expect(card.text).toBe(
			"Token buckets leak\nThe refill rate dominates burst size.",
		);
		expect(card.placements).toHaveLength(1);
	});

	// An agent has no DOM to measure with, so a flat default height fits almost
	// no card it is given to; the placement height has to follow the content.
	test("sizes a created card from its content", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		const short = await call("create_card", { text: "Short", whiteboardId });
		const long = await call("create_card", {
			text: `Long\n${"The refill rate dominates burst size.\n".repeat(12)}`,
			whiteboardId,
		});
		const heights = new Map(
			(
				await call<Array<{ cardId: string; h: number }>>("list_board_items", {
					whiteboardId,
				})
			).map((item) => [item.cardId, item.h]),
		);
		expect(heights.get(long.cardId)).toBeGreaterThan(
			heights.get(short.cardId) as number,
		);
	});

	test("an explicit height wins over the estimate", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		await call("create_card", { text: "Fixed size\nbody", whiteboardId, h: 333 });
		const [item] = await call<Array<{ h: number }>>("list_board_items", {
			whiteboardId,
		});
		expect(item.h).toBe(333);
	});

	test("round trips text through update_card", async () => {
		const { call } = makeTools();
		const { cardId } = await call("create_card", { text: "One\nTwo" });
		await call("update_card", { cardId, text: "One\nTwo\nThree" });
		expect((await call("get_card", { cardId })).text).toBe("One\nTwo\nThree");
	});

	test("archiving a card removes it from its board", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		const { cardId } = await call("create_card", {
			text: "Doomed",
			whiteboardId,
		});
		await call("archive_card", { cardId });
		expect(await call("get_card", { cardId })).toBeNull();
		expect(await call("list_board_items", { whiteboardId })).toHaveLength(0);
	});

	test("finds a card by its text", async () => {
		const { call } = makeTools();
		await call("create_card", { text: "Hybrid logical clocks\nDetail." });
		const results = await call<Array<{ id: string }>>("search_cards", {
			query: "Hybrid logical",
		});
		expect(results.length).toBeGreaterThan(0);
	});

	test("lists cards that are not on any board", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		await call("create_card", { text: "Placed", whiteboardId });
		const { cardId: orphanId } = await call("create_card", {
			text: "Unplaced",
		});
		const orphans = await call<Array<{ id: string }>>("list_cards", {
			orphanOnly: true,
		});
		expect(orphans.map((card) => card.id)).toEqual([orphanId]);
	});
});

describe("references", () => {
	// The point of the whole reference syntax: a citation in prose must produce
	// a real backlink, with no separate call.
	test("a citation in card text becomes a backlink on the target", async () => {
		const { call } = makeTools();
		const { cardId: source } = await call("create_card", {
			text: "Shannon 1948\nA mathematical theory of communication.",
		});
		const { cardId: citing } = await call("create_card", {
			text: `Channel capacity\nThe bound comes from [Shannon 1948](contextboard:card/${source}).`,
		});
		const target = await call("get_card", { cardId: source });
		expect(
			target.backlinks.map((row: { cardId: string }) => row.cardId),
		).toEqual([citing]);
	});

	test("dropping the citation drops the backlink", async () => {
		const { call } = makeTools();
		const { cardId: source } = await call("create_card", { text: "Source" });
		const { cardId: citing } = await call("create_card", {
			text: `Citing\nSee [Source](contextboard:card/${source}).`,
		});
		await call("update_card", { cardId: citing, text: "Citing\nNo longer." });
		expect((await call("get_card", { cardId: source })).backlinks).toEqual([]);
	});

	test("references survive a read/write round trip unchanged", async () => {
		const { call } = makeTools();
		const { cardId: target } = await call("create_card", { text: "Target" });
		const text = `Title\nBoth [a](contextboard:card/${target}) and plain prose.`;
		const { cardId } = await call("create_card", { text });
		const read = await call("get_card", { cardId });
		await call("update_card", { cardId, text: read.text });
		expect((await call("get_card", { cardId })).text).toBe(text);
	});
});

describe("placements", () => {
	test("places one card on several boards independently", async () => {
		const { call } = makeTools();
		const first = await call("create_whiteboard", { title: "First" });
		const second = await call("create_whiteboard", { title: "Second" });
		const { cardId } = await call("create_card", {
			text: "Shared",
			whiteboardId: first.whiteboardId,
		});
		await call("place_card", {
			cardId,
			whiteboardId: second.whiteboardId,
		});
		const card = await call("get_card", { cardId });
		expect(card.placements).toHaveLength(2);
	});

	// A duplicated card here would be silent and hard to notice, so pin it.
	test("placing at a position moves the placement without duplicating the card", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		const { cardId } = await call("create_card", { text: "Positioned" });
		await call("place_card", { cardId, whiteboardId, x: 400, y: 250 });
		const items = await call<
			Array<{ cardId: string | null; x: number; y: number }>
		>("list_board_items", { whiteboardId });
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ cardId, x: 400, y: 250 });
		expect(await call("list_cards", {})).toHaveLength(1);
	});

	test("auto-places cards clear of each other when no position is given", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		for (const text of ["One", "Two", "Three"]) {
			await call("create_card", { text, whiteboardId });
		}
		const items = await call<
			Array<{ x: number; y: number; w: number; h: number }>
		>("list_board_items", { whiteboardId });
		expect(items).toHaveLength(3);
		for (const a of items) {
			for (const b of items) {
				if (a === b) continue;
				const overlaps =
					a.x < b.x + b.w &&
					b.x < a.x + a.w &&
					a.y < b.y + b.h &&
					b.y < a.y + a.h;
				expect(overlaps).toBe(false);
			}
		}
	});

	// The escape hatch: auto-placement must not swallow a deliberate origin.
	test("treats an explicit 0,0 as a position, not as auto-placement", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		await call("create_card", { text: "First", whiteboardId, x: 0, y: 0 });
		const { cardId } = await call("create_card", { text: "Second" });
		await call("place_card", { cardId, whiteboardId, x: 0, y: 0 });
		const items = await call<Array<{ x: number; y: number }>>(
			"list_board_items",
			{ whiteboardId },
		);
		expect(items).toHaveLength(2);
		expect(items.every((item) => item.x === 0 && item.y === 0)).toBe(true);
	});

	test("places a card at an explicit size", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		await call("create_card", { text: "Wide", whiteboardId, w: 800, h: 400 });
		const items = await call<Array<{ w: number; h: number }>>(
			"list_board_items",
			{ whiteboardId },
		);
		expect(items[0]).toMatchObject({ w: 800, h: 400 });
	});

	test("moves an item, keeping the fields that were not passed", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		const { placement } = await call("create_card", {
			text: "Movable",
			whiteboardId,
			x: 10,
			y: 20,
			w: 500,
			h: 300,
		});
		await call("move_item", { whiteboardId, itemId: placement.itemId, x: 900 });
		const items = await call<
			Array<{ x: number; y: number; w: number; h: number }>
		>("list_board_items", { whiteboardId });
		expect(items[0]).toMatchObject({ x: 900, y: 20, w: 500, h: 300 });
	});

	test("refuses to move an item that is not on the given board", async () => {
		const { call } = makeTools();
		const first = await call("create_whiteboard", {});
		const second = await call("create_whiteboard", {});
		const { placement } = await call("create_card", {
			text: "Elsewhere",
			whiteboardId: first.whiteboardId,
		});
		await expect(
			call("move_item", {
				whiteboardId: second.whiteboardId,
				itemId: placement.itemId,
				x: 1,
			}),
		).rejects.toThrow(/not on this whiteboard/);
	});

	test("removing a placement keeps the card and its other placements", async () => {
		const { call } = makeTools();
		const first = await call("create_whiteboard", {});
		const second = await call("create_whiteboard", {});
		const { cardId, placement } = await call("create_card", {
			text: "Kept",
			whiteboardId: first.whiteboardId,
		});
		await call("place_card", { cardId, whiteboardId: second.whiteboardId });
		await call("archive_item", { itemId: placement.itemId });
		const card = await call("get_card", { cardId });
		expect(card).not.toBeNull();
		expect(card.placements).toHaveLength(1);
	});

	test("archiving a whiteboard leaves its cards intact by default", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		const { cardId } = await call("create_card", {
			text: "Survivor",
			whiteboardId,
		});
		await call("archive_whiteboard", { whiteboardId });
		expect(await call("get_card", { cardId })).not.toBeNull();
	});
});

describe("relations", () => {
	async function board() {
		const { call, store } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		const { cardId: a } = await call("create_card", {
			text: "Cause",
			whiteboardId,
		});
		const { cardId: b } = await call("create_card", {
			text: "Effect",
			whiteboardId,
		});
		return { call, store, whiteboardId, a, b };
	}

	test("reports no relations for a board with no arrows", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		expect(await call("list_relations", { whiteboardId })).toEqual([]);
	});

	test("creates a relation that is readable immediately", async () => {
		const { call, whiteboardId, a, b } = await board();

		const created = await call("create_relation", {
			whiteboardId,
			sourceCardId: a,
			targetCardId: b,
		});

		expect(created).toMatchObject({
			whiteboardId,
			relation: "related",
		});
		expect(created.arrowShapeId).toMatch(/^shape:/);
		// The id is the one reconcileCanvasRelations derives, so opening the board
		// later reuses this row rather than creating a second one.
		expect(created.id).toBe(
			`card-relation:${whiteboardId}:${created.arrowShapeId}`,
		);
		expect(await call("list_relations", { whiteboardId })).toHaveLength(1);
		expect(await call("list_relations", { cardId: a })).toHaveLength(1);
	});

	test("draws a real arrow bound to both cards", async () => {
		const { call, store, whiteboardId, a, b } = await board();
		const items = await call("list_board_items", { whiteboardId });
		const shapeOf = (cardId: string) =>
			items.find((item: { cardId: string }) => item.cardId === cardId).shapeId;

		const created = await call("create_relation", {
			whiteboardId,
			sourceCardId: a,
			targetCardId: b,
		});

		const snapshot = await store(whiteboardId);
		expect(snapshot[created.arrowShapeId]).toMatchObject({
			typeName: "shape",
			type: "arrow",
		});

		const bindings = Object.values(snapshot).filter(
			(record) =>
				record.typeName === "binding" && record.fromId === created.arrowShapeId,
		) as ArrowBinding[];
		expect(bindings).toHaveLength(2);
		expect(
			bindings.map((binding) => [binding.props.terminal, binding.toId]),
		).toEqual(
			expect.arrayContaining([
				["start", shapeOf(a)],
				["end", shapeOf(b)],
			]),
		);
	});

	test("relating the same pair twice reuses the arrow", async () => {
		const { call, whiteboardId, a, b } = await board();

		const first = await call("create_relation", {
			whiteboardId,
			sourceCardId: a,
			targetCardId: b,
		});
		// Reversed, because an arrow relation is undirected.
		const second = await call("create_relation", {
			whiteboardId,
			sourceCardId: b,
			targetCardId: a,
		});

		expect(second.id).toBe(first.id);
		expect(await call("list_relations", { whiteboardId })).toHaveLength(1);
	});

	test("refuses to relate a card that is not on the board", async () => {
		const { call, whiteboardId, a } = await board();
		const { cardId: elsewhere } = await call("create_card", {
			text: "Off board",
		});

		await expect(
			call("create_relation", {
				whiteboardId,
				sourceCardId: a,
				targetCardId: elsewhere,
			}),
		).rejects.toThrow(/not on whiteboard .*place_card/s);
	});

	test("refuses to relate a card to itself", async () => {
		const { call, whiteboardId, a } = await board();
		await expect(
			call("create_relation", {
				whiteboardId,
				sourceCardId: a,
				targetCardId: a,
			}),
		).rejects.toThrow(/cannot relate to itself/);
	});

	test("deleting a relation removes the arrow and its bindings", async () => {
		const { call, store, whiteboardId, a, b } = await board();
		const created = await call("create_relation", {
			whiteboardId,
			sourceCardId: a,
			targetCardId: b,
		});

		expect(await call("delete_relation", { relationId: created.id })).toEqual({
			deleted: true,
		});

		expect(await call("list_relations", { whiteboardId })).toEqual([]);
		const snapshot = await store(whiteboardId);
		expect(snapshot[created.arrowShapeId]).toBeUndefined();
		expect(
			Object.values(snapshot).filter(
				(record) => record.fromId === created.arrowShapeId,
			),
		).toEqual([]);
		// The cards themselves survive.
		expect(await call("get_card", { cardId: a })).not.toBeNull();
		expect(await call("get_card", { cardId: b })).not.toBeNull();
	});

	test("deleting an unknown relation is a no-op", async () => {
		const { call } = makeTools();
		expect(
			await call("delete_relation", { relationId: "card-relation:nope" }),
		).toEqual({ deleted: false });
	});
});

describe("errors", () => {
	test("names the missing argument instead of failing obscurely", async () => {
		const { call } = makeTools();
		await expect(call("get_card", {})).rejects.toThrow(/cardId is required/);
	});

	test("returns null for a card that does not exist", async () => {
		const { call } = makeTools();
		expect(await call("get_card", { cardId: "card-missing" })).toBeNull();
	});
});

describe("bridge port discovery", () => {
	test("prefers an explicit environment override", async () => {
		await expect(
			resolveBridgePort({ CONTEXTBOARD_BRIDGE_PORT: "9001" }, async () =>
				JSON.stringify({ port: 1234 }),
			),
		).resolves.toBe(9001);
	});

	test("falls back to the file the desktop app publishes", async () => {
		await expect(
			resolveBridgePort({}, async () => JSON.stringify({ port: 1234 })),
		).resolves.toBe(1234);
	});

	test("uses the default when there is no file to read", async () => {
		await expect(
			resolveBridgePort({}, async () => {
				throw new Error("ENOENT");
			}),
		).resolves.toBe(8787);
	});

	test("ignores an unusable override or a corrupt file", async () => {
		await expect(
			resolveBridgePort({ CONTEXTBOARD_BRIDGE_PORT: "not-a-port" }, async () =>
				JSON.stringify({ port: "nope" }),
			),
		).resolves.toBe(8787);
	});
});
