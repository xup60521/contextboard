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

function makeTools() {
	const database = createContextboardDatabase(crypto.randomUUID());
	databases.push(database);
	const repository = new IndexedDbWorkspaceRepository(database);
	const options = { workspaceId: WORKSPACE_ID };
	const tools = createTools({
		cards: createRepositoryCardsService(repository),
		whiteboards: createRepositoryWhiteboardsService(repository, options),
		canvas: createRepositoryCanvasService(repository, options),
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
	return { call, tools };
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
	test("reports no relations for a board with no arrows", async () => {
		const { call } = makeTools();
		const { whiteboardId } = await call("create_whiteboard", {});
		expect(await call("list_relations", { whiteboardId })).toEqual([]);
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
