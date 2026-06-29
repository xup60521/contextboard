import { describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
	appendCardsToWhiteboard,
	appendToWhiteboard,
	archiveCard,
	archiveCards,
	getContentsForWhiteboardItems,
} from "./cards";
import { getCardTargetKey } from "./fileLifecycle";

type AnyDoc = Record<string, unknown> & { _id: string };

type MockState = {
	whiteboards: Map<string, AnyDoc>;
	cards: Map<string, AnyDoc>;
	boardItems: Map<string, AnyDoc>;
	fileReferences: Map<string, AnyDoc>;
	files: Map<string, AnyDoc>;
};

function makeState(initial?: Partial<Record<keyof MockState, AnyDoc[]>>): MockState {
	return {
		whiteboards: makeCollection(initial?.whiteboards),
		cards: makeCollection(initial?.cards),
		boardItems: makeCollection(initial?.boardItems),
		fileReferences: makeCollection(initial?.fileReferences),
		files: makeCollection(initial?.files),
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
		state.files.get(id) ??
		null;

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
			withIndex(_indexName: string, build: (q: typeof query) => unknown) {
				build(query);
				return this;
			},
			filter(build: (q: typeof query) => unknown) {
				build(query);
				return this;
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

function makeDoc(id: string, fields: Record<string, unknown>): AnyDoc {
	return { _id: id, ...fields };
}

function cardDoc(id: string, archivedAt: number | null = null) {
	return makeDoc(id, {
		whiteboardId: null,
		content: { type: "doc", content: [] },
		derivedTitle: id,
		plainText: id,
		preview: id,
		version: 1,
		archivedAt,
		updatedAt: 100,
	});
}

function boardItemDoc(
	id: string,
	cardId: string,
	whiteboardId: string | null,
	archivedAt: number | null = null,
) {
	return makeDoc(id, {
		whiteboardId,
		kind: "card",
		cardId,
		childWhiteboardId: null,
		shapeId: `shape:${id}`,
		x: 0,
		y: 0,
		w: 1,
		h: 1,
		rotation: 0,
		zIndex: 1,
		archivedAt,
		updatedAt: 100,
	});
}

function whiteboardDoc(id: string, cardCount: number) {
	return makeDoc(id, {
		title: id,
		cardCount,
		childWhiteboardCount: 0,
		archivedAt: null,
		updatedAt: 100,
	});
}

function fileDoc(id: string, refCount: number) {
	return makeDoc(id, {
		storageId: null,
		url: "https://files.example/file",
		kind: "image",
		status: "active",
		refCount,
		contentType: "image/png",
		size: 1,
		sha256: "sha",
		createdAt: 100,
		updatedAt: 100,
		pendingDeleteAt: null,
		deletedAt: null,
	});
}

function fileReferenceDoc(id: string, fileId: string, targetKey: string) {
	return makeDoc(id, {
		fileId,
		targetKey,
		targetType: "card",
		createdAt: 100,
	});
}

const archiveCardHandler = archiveCard as unknown as {
	_handler: (ctx: never, args: { cardId: Id<"cards"> }) => Promise<void>;
};

const archiveCardsHandler = archiveCards as unknown as {
	_handler: (
		ctx: never,
		args: { cardIds: Id<"cards">[] },
	) => Promise<{ archivedCount: number }>;
};

const appendToWhiteboardHandler = appendToWhiteboard as unknown as {
	_handler: (
		ctx: never,
		args: { cardId: Id<"cards">; whiteboardId: Id<"whiteboards"> },
	) => Promise<{
		itemId: Id<"boardItems">;
		whiteboardId: Id<"whiteboards">;
		shapeId: string;
		created: boolean;
	}>;
};

const appendCardsToWhiteboardHandler = appendCardsToWhiteboard as unknown as {
	_handler: (
		ctx: never,
		args: {
			cardIds: Id<"cards">[];
			whiteboardId: Id<"whiteboards">;
		},
	) => Promise<{
		whiteboardId: Id<"whiteboards">;
		appendedCount: number;
		alreadyPresentCount: number;
		skippedMissingCount: number;
	}>;
};

const getContentsForWhiteboardItemsHandler =
	getContentsForWhiteboardItems as unknown as {
		_handler: (
			ctx: never,
			args: { cardIds: Id<"cards">[] },
		) => Promise<
			{
				cardId: Id<"cards">;
				content: unknown;
				version: number;
			}[]
		>;
	};

describe("card archive mutations", () => {
	test("getContentsForWhiteboardItems dedupes ids and skips archived cards", async () => {
		const state = makeState({
			cards: [
				makeDoc("card-1", {
					whiteboardId: null,
					content: { type: "doc", content: [{ type: "paragraph" }] },
					derivedTitle: "Alpha",
					plainText: "Alpha",
					preview: "Alpha",
					version: 2,
					archivedAt: null,
					updatedAt: 100,
				}),
				makeDoc("card-2", {
					whiteboardId: null,
					content: { type: "doc", content: [{ type: "heading" }] },
					derivedTitle: "Beta",
					plainText: "Beta",
					preview: "Beta",
					version: 5,
					archivedAt: 123,
					updatedAt: 100,
				}),
			],
		});

		const result = await getContentsForWhiteboardItemsHandler._handler(
			makeMockCtx(state),
			{
				cardIds: [
					"card-1" as Id<"cards">,
					"card-1" as Id<"cards">,
					"card-2" as Id<"cards">,
					"card-missing" as Id<"cards">,
				],
			},
		);

		expect(result).toEqual([
			{
				cardId: "card-1",
				content: { type: "doc", content: [{ type: "paragraph" }] },
				version: 2,
			},
		]);
	});

	test("getContentsForWhiteboardItems rejects batches larger than 30 unique cards", async () => {
		const ctx = makeMockCtx(makeState());
		const cardIds = Array.from({ length: 31 }, (_, index) => `card-${index}`) as Id<
			"cards"
		>[];

		await expect(
			getContentsForWhiteboardItemsHandler._handler(ctx, { cardIds }),
		).rejects.toThrow("Cannot load more than 30 card contents at once");
	});

	test("archiveCard preserves the single-card archive behavior", async () => {
		const state = makeState({
			whiteboards: [whiteboardDoc("whiteboard-1", 1)],
			cards: [cardDoc("card-1")],
			boardItems: [boardItemDoc("board-item-1", "card-1", "whiteboard-1")],
			files: [fileDoc("file-1", 1)],
			fileReferences: [
				fileReferenceDoc(
					"reference-1",
					"file-1",
					getCardTargetKey("card-1" as Id<"cards">),
				),
			],
		});

		const ctx = makeMockCtx(state);
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

		try {
			await archiveCardHandler._handler(ctx, {
				cardId: "card-1" as Id<"cards">,
			});
		} finally {
			nowSpy.mockRestore();
		}

		expect(state.cards.get("card-1")).toMatchObject({
			archivedAt: now,
			updatedAt: now,
		});
		expect(state.boardItems.get("board-item-1")).toMatchObject({
			archivedAt: now,
			updatedAt: now,
		});
		expect(state.whiteboards.get("whiteboard-1")).toMatchObject({
			cardCount: 0,
			updatedAt: now,
		});
		expect(state.fileReferences.size).toBe(0);
		expect(state.files.get("file-1")).toMatchObject({
			refCount: 0,
			status: "pending_delete",
			updatedAt: now,
		});
	});

	test("archiveCards archives multiple cards and deduplicates repeated ids", async () => {
		const state = makeState({
			whiteboards: [
				whiteboardDoc("whiteboard-a", 1),
				whiteboardDoc("whiteboard-b", 2),
				whiteboardDoc("whiteboard-c", 1),
			],
			cards: [
				cardDoc("card-1"),
				cardDoc("card-2"),
				cardDoc("card-3", 123),
			],
			boardItems: [
				boardItemDoc("board-item-1", "card-1", "whiteboard-a"),
				boardItemDoc("board-item-2", "card-1", "whiteboard-b"),
				boardItemDoc("board-item-3", "card-2", "whiteboard-b"),
				boardItemDoc("board-item-4", "card-2", "whiteboard-c"),
				boardItemDoc("board-item-5", "card-3", "whiteboard-c", 999),
			],
			files: [
				fileDoc("file-1", 1),
				fileDoc("file-2", 1),
			],
			fileReferences: [
				fileReferenceDoc(
					"reference-1",
					"file-1",
					getCardTargetKey("card-1" as Id<"cards">),
				),
				fileReferenceDoc(
					"reference-2",
					"file-2",
					getCardTargetKey("card-2" as Id<"cards">),
				),
			],
		});

		const ctx = makeMockCtx(state);
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

		try {
			const result = await archiveCardsHandler._handler(ctx, {
				cardIds: [
					"card-1" as Id<"cards">,
					"card-2" as Id<"cards">,
					"card-1" as Id<"cards">,
					"card-3" as Id<"cards">,
				],
			});

			expect(result).toEqual({ archivedCount: 3 });
		} finally {
			nowSpy.mockRestore();
		}

		expect(state.cards.get("card-1")).toMatchObject({
			archivedAt: now,
			updatedAt: now,
		});
		expect(state.cards.get("card-2")).toMatchObject({
			archivedAt: now,
			updatedAt: now,
		});
		expect(state.cards.get("card-3")).toMatchObject({
			archivedAt: 123,
		});

		expect(state.boardItems.get("board-item-1")).toMatchObject({
			archivedAt: now,
		});
		expect(state.boardItems.get("board-item-2")).toMatchObject({
			archivedAt: now,
		});
		expect(state.boardItems.get("board-item-3")).toMatchObject({
			archivedAt: now,
		});
		expect(state.boardItems.get("board-item-4")).toMatchObject({
			archivedAt: now,
		});
		expect(state.boardItems.get("board-item-5")).toMatchObject({
			archivedAt: 999,
		});

		expect(state.whiteboards.get("whiteboard-a")).toMatchObject({
			cardCount: 0,
			updatedAt: now,
		});
		expect(state.whiteboards.get("whiteboard-b")).toMatchObject({
			cardCount: 0,
			updatedAt: now,
		});
		expect(state.whiteboards.get("whiteboard-c")).toMatchObject({
			cardCount: 0,
			updatedAt: now,
		});

		expect(state.fileReferences.size).toBe(0);
		expect(state.files.get("file-1")).toMatchObject({
			refCount: 0,
			status: "pending_delete",
		});
		expect(state.files.get("file-2")).toMatchObject({
			refCount: 0,
			status: "pending_delete",
		});
	});

	test("archiveCards handles an empty array", async () => {
		const state = makeState();
		const ctx = makeMockCtx(state);

		const result = await archiveCardsHandler._handler(ctx, {
			cardIds: [],
		});

		expect(result).toEqual({ archivedCount: 0 });
		expect(state.cards.size).toBe(0);
		expect(state.boardItems.size).toBe(0);
		expect(state.whiteboards.size).toBe(0);
	});
});

describe("card append mutations", () => {
	test("appendToWhiteboard preserves the single-card append behavior", async () => {
		const state = makeState({
			whiteboards: [whiteboardDoc("whiteboard-1", 0)],
			cards: [cardDoc("card-1")],
		});

		const ctx = makeMockCtx(state);
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

		try {
			const result = await appendToWhiteboardHandler._handler(ctx, {
				cardId: "card-1" as Id<"cards">,
				whiteboardId: "whiteboard-1" as Id<"whiteboards">,
			});

			expect(result).toEqual({
				itemId: "boardItems:1",
				whiteboardId: "whiteboard-1",
				shapeId: "shape:card-card-1",
				created: true,
			});
		} finally {
			nowSpy.mockRestore();
		}

		expect(state.boardItems.get("boardItems:1")).toMatchObject({
			cardId: "card-1",
			whiteboardId: "whiteboard-1",
			shapeId: "shape:card-card-1",
			x: 0,
			y: 0,
			archivedAt: null,
			updatedAt: now,
		});
		expect(state.whiteboards.get("whiteboard-1")).toMatchObject({
			cardCount: 1,
			updatedAt: now,
		});
		expect(state.cards.get("card-1")).toMatchObject({
			updatedAt: now,
		});
	});

	test("appendCardsToWhiteboard deduplicates ids and aggregates append outcomes", async () => {
		const state = makeState({
			whiteboards: [whiteboardDoc("whiteboard-1", 1)],
			cards: [
				cardDoc("card-new"),
				cardDoc("card-existing"),
				cardDoc("card-restored"),
				cardDoc("card-archived", 123),
			],
			boardItems: [
				boardItemDoc("board-item-existing", "card-existing", "whiteboard-1"),
				makeDoc("board-item-restored", {
					whiteboardId: "whiteboard-1",
					kind: "card",
					cardId: "card-restored",
					childWhiteboardId: null,
					shapeId: "shape:card-card-restored",
					x: 0,
					y: 80,
					w: 1,
					h: 1,
					rotation: 0,
					zIndex: 1,
					archivedAt: 999,
					updatedAt: 100,
				}),
			],
		});

		const ctx = makeMockCtx(state);
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

		try {
			const result = await appendCardsToWhiteboardHandler._handler(ctx, {
				cardIds: [
					"card-new" as Id<"cards">,
					"card-existing" as Id<"cards">,
					"card-restored" as Id<"cards">,
					"card-new" as Id<"cards">,
					"card-missing" as Id<"cards">,
					"card-archived" as Id<"cards">,
				],
				whiteboardId: "whiteboard-1" as Id<"whiteboards">,
			});

			expect(result).toEqual({
				whiteboardId: "whiteboard-1",
				appendedCount: 2,
				alreadyPresentCount: 1,
				skippedMissingCount: 2,
			});
		} finally {
			nowSpy.mockRestore();
		}

		expect(state.boardItems.get("boardItems:1")).toMatchObject({
			cardId: "card-new",
			whiteboardId: "whiteboard-1",
			shapeId: "shape:card-card-new",
			x: 624,
			y: 0,
			archivedAt: null,
			updatedAt: now,
		});
		expect(state.boardItems.get("board-item-restored")).toMatchObject({
			archivedAt: null,
			updatedAt: now,
		});
		expect(state.whiteboards.get("whiteboard-1")).toMatchObject({
			cardCount: 3,
			updatedAt: now,
		});
		expect(state.cards.get("card-new")).toMatchObject({
			updatedAt: now,
		});
		expect(state.cards.get("card-restored")).toMatchObject({
			updatedAt: now,
		});
		expect(state.cards.get("card-existing")).toMatchObject({
			updatedAt: 100,
		});
	});

	test("appendCardsToWhiteboard throws for a missing or archived whiteboard", async () => {
		const state = makeState({
			whiteboards: [
				makeDoc("whiteboard-archived", {
					title: "archived",
					cardCount: 0,
					childWhiteboardCount: 0,
					archivedAt: 1,
					updatedAt: 100,
				}),
			],
			cards: [cardDoc("card-1")],
		});

		const ctx = makeMockCtx(state);

		await expect(
			appendCardsToWhiteboardHandler._handler(ctx, {
				cardIds: ["card-1" as Id<"cards">],
				whiteboardId: "whiteboard-missing" as Id<"whiteboards">,
			}),
		).rejects.toThrow("Whiteboard not found");

		await expect(
			appendCardsToWhiteboardHandler._handler(ctx, {
				cardIds: ["card-1" as Id<"cards">],
				whiteboardId: "whiteboard-archived" as Id<"whiteboards">,
			}),
		).rejects.toThrow("Whiteboard not found");
	});

	test("appendCardsToWhiteboard rejects more than 100 unique cards", async () => {
		const state = makeState({
			whiteboards: [whiteboardDoc("whiteboard-1", 0)],
		});
		const ctx = makeMockCtx(state);
		const cardIds = Array.from({ length: 101 }, (_, index) => {
			const cardId = `card-${index + 1}`;
			state.cards.set(cardId, cardDoc(cardId));
			return cardId as Id<"cards">;
		});

		await expect(
			appendCardsToWhiteboardHandler._handler(ctx, {
				cardIds,
				whiteboardId: "whiteboard-1" as Id<"whiteboards">,
			}),
		).rejects.toThrow("Cannot append more than 100 cards at once");
	});

	test("appendCardsToWhiteboard lays out newly created cards horizontally", async () => {
		const state = makeState({
			whiteboards: [whiteboardDoc("whiteboard-1", 0)],
			cards: [cardDoc("card-1"), cardDoc("card-2")],
		});
		const ctx = makeMockCtx(state);
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

		try {
			const result = await appendCardsToWhiteboardHandler._handler(ctx, {
				cardIds: ["card-1" as Id<"cards">, "card-2" as Id<"cards">],
				whiteboardId: "whiteboard-1" as Id<"whiteboards">,
			});

			expect(result).toEqual({
				whiteboardId: "whiteboard-1",
				appendedCount: 2,
				alreadyPresentCount: 0,
				skippedMissingCount: 0,
			});
		} finally {
			nowSpy.mockRestore();
		}

		expect(state.boardItems.get("boardItems:1")).toMatchObject({
			cardId: "card-1",
			x: 0,
			y: 0,
		});
		expect(state.boardItems.get("boardItems:2")).toMatchObject({
			cardId: "card-2",
			x: 624,
			y: 0,
		});
	});
});
