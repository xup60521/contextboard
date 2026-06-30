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
	function makeQuery(map: Map<string, AnyDoc>) {
		const criteria: Array<[string, unknown]> = [];

		const query = {
			eq(field: string, value: unknown) {
				criteria.push([field, value]);
				return query;
			},
			field(field: string) {
				return field;
			},
		};

		const filtered = () =>
			[...map.values()].filter((doc) =>
				criteria.every(([field, value]) => doc[field] === value),
			);

		return {
			filter(build: (q: typeof query) => unknown) {
				build(query);
				return this;
			},
			async collect() {
				return filtered();
			},
		};
	}

	return {
		db: {
			get: async (id: string) => state.cards.get(id) ?? null,
			query: (table: keyof MockState) => makeQuery(state[table]),
		},
	} as never;
}

function makeDoc(id: string, fields: Record<string, unknown>): AnyDoc {
	return { _id: id, ...fields };
}

const getHandler = get as unknown as {
	_handler: (
		ctx: never,
		args: { activeCardId: string | null },
	) => Promise<{
		whiteboards: Array<{ _id: string; title: string }>;
		activeCardTitle: string | null;
	}>;
};

describe("sidebar.get", () => {
	test("returns only active whiteboards and the active card title", async () => {
		const result = await getHandler._handler(
			makeMockCtx(
				makeState({
					whiteboards: [
						makeDoc("whiteboard-2", {
							title: "Board B",
							archivedAt: null,
						}),
						makeDoc("whiteboard-3", {
							title: "Archived",
							archivedAt: 123,
						}),
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
				activeCardId: "card-1",
			},
		);

		expect(result).toEqual({
			whiteboards: [
				{ _id: "whiteboard-1", title: "Board A" },
				{ _id: "whiteboard-2", title: "Board B" },
			],
			activeCardTitle: "Alpha card",
		});
	});

	test("returns null when the active card is missing or archived", async () => {
		const missingResult = await getHandler._handler(makeMockCtx(makeState()), {
			activeCardId: "missing-card",
		});

		expect(missingResult.activeCardTitle).toBeNull();

		const archivedResult = await getHandler._handler(
			makeMockCtx(
				makeState({
					cards: [
						makeDoc("card-archived", {
							derivedTitle: "Hidden card",
							archivedAt: 123,
						}),
					],
				}),
			),
			{
				activeCardId: "card-archived",
			},
		);

		expect(archivedResult.activeCardTitle).toBeNull();
		expect(archivedResult.whiteboards).toEqual([]);
	});
});
