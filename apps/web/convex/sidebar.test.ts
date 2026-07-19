import { describe, expect, test } from "vitest";
import { get } from "./sidebar";

type AnyDoc = Record<string, unknown> & { _id: string };

type MockState = {
	whiteboards: Map<string, AnyDoc>;
	cards: Map<string, AnyDoc>;
};

function makeState(initial?: Partial<Record<keyof MockState, AnyDoc[]>>): MockState {
	return {
		whiteboards: makeCollection(initial?.whiteboards),
		cards: makeCollection(initial?.cards),
	};
}

function makeCollection(items?: AnyDoc[]) {
	return new Map((items ?? []).map((item) => [item._id, item] as const));
}

function makeMockCtx(state: MockState) {
	return {
		db: {
			get: async (id: string) => state.whiteboards.get(id) ?? state.cards.get(id) ?? null,
		},
	} as never;
}

function makeDoc(id: string, fields: Record<string, unknown>): AnyDoc {
	return { _id: id, ...fields };
}

const getHandler = get as unknown as {
	_handler: (
		ctx: never,
		args: { whiteboardIds: string[]; cardIds: string[] },
	) => Promise<{
		whiteboards: Array<{ _id: string; title: string }>;
		cards: Array<{ _id: string; title: string }>;
	}>;
};

describe("sidebar.get", () => {
	test("returns only active whiteboards and cards with stable minimal fields", async () => {
		const result = await getHandler._handler(
			makeMockCtx(
				makeState({
					whiteboards: [
						makeDoc("whiteboard-2", {
							title: "Board B",
							archivedAt: null,
							ancestorIds: ["ancestor-1"],
							breadcrumbs: ["should not leak"],
						}),
						makeDoc("whiteboard-3", {
							title: "Archived",
							archivedAt: 123,
							ancestorIds: ["ancestor-2"],
						}),
						makeDoc("whiteboard-1", {
							title: "Board A",
							archivedAt: null,
							ancestorIds: [],
						}),
					],
					cards: [
						makeDoc("card-1", {
							derivedTitle: "Alpha card",
							archivedAt: null,
							content: { text: "should not leak" },
							backlinks: ["should not leak"],
							placements: ["should not leak"],
						}),
						makeDoc("card-2", {
							derivedTitle: "Archived card",
							archivedAt: 123,
						}),
					],
				}),
			),
			{
				whiteboardIds: ["whiteboard-2", "whiteboard-3", "whiteboard-1"],
				cardIds: ["card-1", "card-2"],
			},
		);

		expect(result).toEqual({
			whiteboards: [
				{ _id: "whiteboard-1", title: "Board A" },
				{ _id: "whiteboard-2", title: "Board B" },
			],
			cards: [{ _id: "card-1", title: "Alpha card" }],
		});
	});

	test("dedupes ids and skips missing documents", async () => {
		const result = await getHandler._handler(
			makeMockCtx(
				makeState({
					whiteboards: [
						makeDoc("whiteboard-1", {
							title: "Board A",
							archivedAt: null,
						}),
					],
					cards: [
						makeDoc("card-1", {
							derivedTitle: "Alpha card",
							archivedAt: null,
						}),
					],
				}),
			),
			{
				whiteboardIds: ["whiteboard-1", "whiteboard-1", "missing-whiteboard"],
				cardIds: ["card-1", "card-1", "missing-card"],
			},
		);

		expect(result).toEqual({
			whiteboards: [{ _id: "whiteboard-1", title: "Board A" }],
			cards: [{ _id: "card-1", title: "Alpha card" }],
		});
	});

	test("rejects more than 100 ids per collection", async () => {
		const whiteboardIds = Array.from({ length: 101 }, (_, index) => `whiteboard-${index}`);
		const cardIds = Array.from({ length: 101 }, (_, index) => `card-${index}`);

		await expect(
			getHandler._handler(makeMockCtx(makeState()), {
				whiteboardIds,
				cardIds: [],
			}),
		).rejects.toThrow("Cannot load more than 100 whiteboards at once");

		await expect(
			getHandler._handler(makeMockCtx(makeState()), {
				whiteboardIds: [],
				cardIds,
			}),
		).rejects.toThrow("Cannot load more than 100 cards at once");
	});
});
