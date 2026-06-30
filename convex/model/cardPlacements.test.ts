import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
	getActivePlacementOnBoard,
	hasActivePlacementOnBoard,
	listActivePlacements,
	selectPreferredPlacement,
	type ActiveCardPlacement,
} from "./cardPlacements";

type BoardItemDoc = {
	_id: Id<"boardItems">;
	whiteboardId: Id<"whiteboards"> | null;
	kind: "card" | "subwhiteboard";
	cardId: Id<"cards"> | null;
	childWhiteboardId: Id<"whiteboards"> | null;
	shapeId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
	archivedAt: number | null;
	updatedAt: number;
};

function makeBoardItem(
	id: string,
	overrides: Partial<BoardItemDoc> = {},
): BoardItemDoc {
	return {
		_id: id as Id<"boardItems">,
		whiteboardId: "board-a" as Id<"whiteboards">,
		kind: "card",
		cardId: "card-1" as Id<"cards">,
		childWhiteboardId: null,
		shapeId: `shape:${id}`,
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		rotation: 0,
		zIndex: 0,
		archivedAt: null,
		updatedAt: 100,
		...overrides,
	};
}

function makeMockCtx(items: BoardItemDoc[]) {
	const usedIndexes: string[] = [];

	function makeQuery() {
		const criteria: Array<[keyof BoardItemDoc, unknown]> = [];

		const query = {
			eq(field: keyof BoardItemDoc, value: unknown) {
				criteria.push([field, value]);
				return query;
			},
		};

		const filtered = () =>
			items.filter((item) =>
				criteria.every(([field, value]) => item[field] === value),
			);

		return {
			withIndex(indexName: string, build: (q: typeof query) => unknown) {
				usedIndexes.push(indexName);
				build(query);
				return this;
			},
			async collect() {
				return filtered();
			},
			async first() {
				return filtered()[0] ?? null;
			},
		};
	}

	return {
		ctx: {
			db: {
				query: (table: "boardItems") => {
					expect(table).toBe("boardItems");
					return makeQuery();
				},
			},
		} as never,
		usedIndexes,
	};
}

function makePlacement(
	id: string,
	whiteboardId: string,
	updatedAt: number,
): ActiveCardPlacement {
	return {
		_id: id as Id<"boardItems">,
		cardId: "card-1" as Id<"cards">,
		whiteboardId: whiteboardId as Id<"whiteboards">,
		shapeId: `shape:${id}`,
		updatedAt,
	};
}

describe("listActivePlacements", () => {
	test("uses the card archived updated index", async () => {
		const { ctx, usedIndexes } = makeMockCtx([
			makeBoardItem("item-a", { cardId: "card-1" as Id<"cards"> }),
		]);

		await listActivePlacements(ctx, "card-1" as Id<"cards">);

		expect(usedIndexes).toEqual(["by_card_archived_updated"]);
	});

	test("returns only active card placements for the requested card", async () => {
		const { ctx } = makeMockCtx([
			makeBoardItem("item-active", {
				cardId: "card-1" as Id<"cards">,
				archivedAt: null,
			}),
			makeBoardItem("item-archived", {
				cardId: "card-1" as Id<"cards">,
				archivedAt: 123,
			}),
			makeBoardItem("item-other-card", {
				cardId: "card-2" as Id<"cards">,
				archivedAt: null,
			}),
			makeBoardItem("item-subwhiteboard", {
				kind: "subwhiteboard",
				cardId: null,
				childWhiteboardId: "board-child" as Id<"whiteboards">,
				archivedAt: null,
			}),
		]);

		const placements = await listActivePlacements(ctx, "card-1" as Id<"cards">);

		expect(placements).toEqual([
			{
				_id: "item-active",
				cardId: "card-1",
				whiteboardId: "board-a",
				shapeId: "shape:item-active",
				updatedAt: 100,
			},
		]);
	});

	test("sorts active placements by descending updatedAt", async () => {
		const { ctx } = makeMockCtx([
			makeBoardItem("item-old", {
				cardId: "card-1" as Id<"cards">,
				updatedAt: 100,
			}),
			makeBoardItem("item-new", {
				cardId: "card-1" as Id<"cards">,
				updatedAt: 300,
			}),
			makeBoardItem("item-middle", {
				cardId: "card-1" as Id<"cards">,
				updatedAt: 200,
			}),
		]);

		const placements = await listActivePlacements(ctx, "card-1" as Id<"cards">);

		expect(placements.map((placement) => placement._id)).toEqual([
			"item-new",
			"item-middle",
			"item-old",
		]);
	});
});

describe("getActivePlacementOnBoard", () => {
	test("uses the card whiteboard archived index", async () => {
		const { ctx, usedIndexes } = makeMockCtx([
			makeBoardItem("item-a", {
				cardId: "card-1" as Id<"cards">,
				whiteboardId: "board-a" as Id<"whiteboards">,
			}),
		]);

		await getActivePlacementOnBoard(
			ctx,
			"card-1" as Id<"cards">,
			"board-a" as Id<"whiteboards">,
		);

		expect(usedIndexes).toEqual(["by_card_whiteboard_archived"]);
	});

	test("returns the active placement on the requested whiteboard", async () => {
		const { ctx } = makeMockCtx([
			makeBoardItem("item-a", {
				cardId: "card-1" as Id<"cards">,
				whiteboardId: "board-a" as Id<"whiteboards">,
				updatedAt: 200,
			}),
			makeBoardItem("item-b", {
				cardId: "card-1" as Id<"cards">,
				whiteboardId: "board-b" as Id<"whiteboards">,
				updatedAt: 300,
			}),
		]);

		const placement = await getActivePlacementOnBoard(
			ctx,
			"card-1" as Id<"cards">,
			"board-b" as Id<"whiteboards">,
		);

		expect(placement).toEqual({
			_id: "item-b",
			cardId: "card-1",
			whiteboardId: "board-b",
			shapeId: "shape:item-b",
			updatedAt: 300,
		});
	});

	test("returns null for archived placements", async () => {
		const { ctx } = makeMockCtx([
			makeBoardItem("item-archived", {
				cardId: "card-1" as Id<"cards">,
				whiteboardId: "board-a" as Id<"whiteboards">,
				archivedAt: 123,
			}),
		]);

		const placement = await getActivePlacementOnBoard(
			ctx,
			"card-1" as Id<"cards">,
			"board-a" as Id<"whiteboards">,
		);

		expect(placement).toBeNull();
	});
});

describe("hasActivePlacementOnBoard", () => {
	test("returns true or false using the board-specific lookup", async () => {
		const { ctx, usedIndexes } = makeMockCtx([
			makeBoardItem("item-a", {
				cardId: "card-1" as Id<"cards">,
				whiteboardId: "board-a" as Id<"whiteboards">,
			}),
		]);

		await expect(
			hasActivePlacementOnBoard(
				ctx,
				"card-1" as Id<"cards">,
				"board-a" as Id<"whiteboards">,
			),
		).resolves.toBe(true);
		await expect(
			hasActivePlacementOnBoard(
				ctx,
				"card-1" as Id<"cards">,
				"board-b" as Id<"whiteboards">,
			),
		).resolves.toBe(false);

		expect(usedIndexes).toEqual([
			"by_card_whiteboard_archived",
			"by_card_whiteboard_archived",
		]);
	});
});

describe("selectPreferredPlacement", () => {
	test("prefers the current board placement when available", () => {
		const placements = [
			makePlacement("item-a", "board-a", 100),
			makePlacement("item-b", "board-b", 200),
		];

		expect(selectPreferredPlacement(placements, "board-a" as Id<"whiteboards">))
			.toMatchObject({
				_id: "item-a",
			});
	});

	test("falls back to the most recently updated placement", () => {
		const placements = [
			makePlacement("item-a", "board-a", 100),
			makePlacement("item-b", "board-b", 200),
		];

		expect(selectPreferredPlacement(placements)).toMatchObject({
			_id: "item-b",
		});
	});
});
