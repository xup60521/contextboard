import { describe, expect, test } from "vitest";
import { listItems, restoreOrAdoptCardItemImpl } from "./canvas";

type AnyDoc = Record<string, unknown> & { _id: string };

type MockState = {
	whiteboards: Map<string, AnyDoc>;
	cards: Map<string, AnyDoc>;
	boardItems: Map<string, AnyDoc>;
	fileReferences: Map<string, AnyDoc>;
};

function makeState(initial?: Partial<Record<keyof MockState, AnyDoc[]>>): MockState {
	return {
		whiteboards: makeCollection(initial?.whiteboards),
		cards: makeCollection(initial?.cards),
		boardItems: makeCollection(initial?.boardItems),
		fileReferences: makeCollection(initial?.fileReferences),
	};
}

function makeCollection(items?: AnyDoc[]) {
	return new Map((items ?? []).map((item) => [item._id, item] as const));
}

function makeMockCtx(state: MockState) {
	let nextId = 1;

	const getById = (id: string) =>
		state.whiteboards.get(id) ??
		state.cards.get(id) ??
		state.boardItems.get(id) ??
		state.fileReferences.get(id) ??
		null;

	function makeQuery(map: Map<string, AnyDoc>) {
		const criteria: Array<[string, unknown]> = [];

		const query = {
			eq(field: string, value: unknown) {
				criteria.push([field, value]);
				return query;
			},
		};

		const filtered = () =>
			[...map.values()].filter((doc) =>
				criteria.every(([field, value]) => doc[field] === value),
			);

		return {
			withIndex(_indexName: string, build: (q: typeof query) => unknown) {
				build(query);
				return this;
			},
			async paginate() {
				return {
					page: filtered(),
					isDone: true,
					continueCursor: "",
				};
			},
			async first() {
				return filtered()[0] ?? null;
			},
			async collect() {
				return filtered();
			},
			async *[Symbol.asyncIterator]() {
				for (const doc of filtered()) {
					yield doc;
				}
			},
		};
	}

	return {
		db: {
			get: async (id: string) => getById(id),
			insert: async (table: keyof MockState, doc: AnyDoc) => {
				const id = `${table}:${nextId++}`;
				const stored = { ...doc, _id: id };
				state[table].set(id, stored);
				return id;
			},
			patch: async (id: string, patch: Record<string, unknown>) => {
				const doc = getById(id);
				if (!doc) {
					throw new Error(`Missing doc: ${id}`);
				}
				Object.assign(doc, patch);
			},
			delete: async (id: string) => {
				for (const collection of Object.values(state)) {
					if (collection.delete(id)) return;
				}
			},
			normalizeId: (_table: string, id: string) => (getById(id) ? id : null),
			query: (table: keyof MockState) => makeQuery(state[table]),
		},
		storage: {
			getUrl: async () => null,
			delete: async () => {},
		},
		scheduler: {
			runAfter: async () => {},
		},
	} as never;
}

const listItemsHandler = listItems as unknown as {
	_handler: (
		ctx: never,
		args: {
			whiteboardId: string | null;
			paginationOpts: { cursor: string | null; numItems: number };
		},
	) => Promise<{
		page: Array<{
			card: {
				_id: string;
				derivedTitle: string;
				preview: string;
				version: number;
			} | null;
		}>;
	}>;
};

function makeDoc(id: string, fields: Record<string, unknown>): AnyDoc {
	return { _id: id, ...fields };
}

function docText(text: string) {
	return JSON.stringify({
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text }],
			},
		],
	});
}

describe("restoreOrAdoptCardItemImpl", () => {
	test("listItems omits full card content from card payloads", async () => {
		const state = makeState({
			cards: [
				makeDoc("card-1", {
					whiteboardId: null,
					content: { type: "doc", content: [{ type: "paragraph" }] },
					derivedTitle: "Card title",
					plainText: "Card title",
					preview: "Card preview",
					version: 4,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
			boardItems: [
				makeDoc("boardItem-1", {
					whiteboardId: "whiteboard-1",
					kind: "card",
					cardId: "card-1",
					childWhiteboardId: null,
					shapeId: "shape:card-1",
					x: 10,
					y: 20,
					w: 576,
					h: 160,
					rotation: 0,
					zIndex: 1,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
		});

		const result = await listItemsHandler._handler(makeMockCtx(state), {
			whiteboardId: "whiteboard-1",
			paginationOpts: { cursor: null, numItems: 50 },
		});

		expect(result.page).toHaveLength(1);
		expect(result.page[0]?.card).toEqual({
			_id: "card-1",
			derivedTitle: "Card title",
			preview: "Card preview",
			version: 4,
		});
	});

	test("creates another placement for a pasted Convex-backed card", async () => {
		const state = makeState({
			whiteboards: [
				makeDoc("whiteboard-1", {
					title: "Board",
					cardCount: 1,
					childWhiteboardCount: 0,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
			cards: [
				makeDoc("card-1", {
					whiteboardId: null,
					content: { type: "doc", content: [] },
					derivedTitle: "Original",
					plainText: "Original",
					preview: "Original",
					version: 1,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
			boardItems: [
				makeDoc("boardItem-1", {
					whiteboardId: "whiteboard-1",
					kind: "card",
					cardId: "card-1",
					childWhiteboardId: null,
					shapeId: "shape:existing",
					x: 10,
					y: 20,
					w: 576,
					h: 160,
					rotation: 0,
					zIndex: 1,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
		});

		const ctx = makeMockCtx(state);
		const itemId = await restoreOrAdoptCardItemImpl(ctx, {
			whiteboardId: "whiteboard-1" as never,
			shapeId: "shape:paste-1",
			sourceCardId: "card-1",
			content: docText("ignored"),
			x: 30,
			y: 40,
			w: 600,
			h: 180,
			rotation: 0,
		});

		expect(itemId).toBeDefined();
		expect(state.cards.size).toBe(1);
		expect(state.whiteboards.get("whiteboard-1")?.cardCount).toBe(2);

		const pastedItem = state.boardItems.get(itemId as string);
		expect(pastedItem).toMatchObject({
			whiteboardId: "whiteboard-1",
			kind: "card",
			cardId: "card-1",
			shapeId: "shape:paste-1",
			x: 30,
			y: 40,
			w: 600,
			h: 180,
			rotation: 0,
			archivedAt: null,
		});
	});

	test("falls back to a new card when the source card id is missing or stale", async () => {
		const state = makeState({
			whiteboards: [
				makeDoc("whiteboard-1", {
					title: "Board",
					cardCount: 0,
					childWhiteboardCount: 0,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
		});

		const ctx = makeMockCtx(state);
		const itemId = await restoreOrAdoptCardItemImpl(ctx, {
			whiteboardId: "whiteboard-1" as never,
			shapeId: "shape:paste-2",
			sourceCardId: "not-a-real-card-id",
			content: docText("fresh"),
			x: 1,
			y: 2,
			w: 3,
			h: 4,
			rotation: 0,
		});

		expect(itemId).toBeDefined();
		expect(state.cards.size).toBe(1);
		expect(state.whiteboards.get("whiteboard-1")?.cardCount).toBe(1);

		const pastedItem = state.boardItems.get(itemId as string);
		expect(pastedItem?.cardId).not.toBe("not-a-real-card-id");
		expect(pastedItem).toMatchObject({
			whiteboardId: "whiteboard-1",
			kind: "card",
			shapeId: "shape:paste-2",
		});
	});

	test("restores an archived item when the shape id already exists", async () => {
		const state = makeState({
			whiteboards: [
				makeDoc("whiteboard-1", {
					title: "Board",
					cardCount: 0,
					childWhiteboardCount: 0,
					archivedAt: null,
					updatedAt: 100,
				}),
			],
			cards: [
				makeDoc("card-1", {
					whiteboardId: null,
					content: { type: "doc", content: [] },
					derivedTitle: "Archived",
					plainText: "Archived",
					preview: "Archived",
					version: 1,
					archivedAt: 123,
					updatedAt: 100,
				}),
			],
			boardItems: [
				makeDoc("boardItem-1", {
					whiteboardId: "whiteboard-1",
					kind: "card",
					cardId: "card-1",
					childWhiteboardId: null,
					shapeId: "shape:restore-1",
					x: 10,
					y: 20,
					w: 576,
					h: 160,
					rotation: 0,
					zIndex: 1,
					archivedAt: 456,
					updatedAt: 100,
				}),
			],
		});

		const ctx = makeMockCtx(state);
		const itemId = await restoreOrAdoptCardItemImpl(ctx, {
			whiteboardId: "whiteboard-1" as never,
			shapeId: "shape:restore-1",
			content: docText("ignored"),
			x: 30,
			y: 40,
			w: 600,
			h: 180,
			rotation: 0,
		});

		expect(itemId).toBe("boardItem-1");
		expect(state.cards.size).toBe(1);
		expect(state.boardItems.size).toBe(1);
		expect(state.boardItems.get("boardItem-1")?.archivedAt).toBeNull();
		expect(state.cards.get("card-1")?.archivedAt).toBeNull();
		expect(state.whiteboards.get("whiteboard-1")?.cardCount).toBe(1);
	});
});
