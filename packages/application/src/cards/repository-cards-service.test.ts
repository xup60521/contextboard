import { describe, expect, test } from "vitest";
import { createRepositoryWhiteboardsService } from "../canvas/services";
import { listRows } from "../repository/entities";
import { createMemoryWorkspaceRepository } from "../testing";
import { deriveCardMetadata, textToCardContent } from "./card-content";
import { cardsServiceConformance } from "./conformance";
import { createRepositoryCardsService } from "./repository-cards-service";

const service = () => {
	let clock = 1_000;
	let counter = 0;
	const repository = createMemoryWorkspaceRepository({ now: () => ++clock });
	return {
		repository,
		cards: createRepositoryCardsService(repository, {
			now: () => ++clock,
			createId: () => `card-${++counter}`,
		}),
	};
};

describe("shared card conformance (in-memory entity store)", () => {
	for (const scenario of cardsServiceConformance) {
		test(scenario.name, async () => {
			await scenario.run(service().cards);
		});
	}
});

describe("repository card capability", () => {
	test("creates a card with derived metadata through the allowlisted command", async () => {
		const { cards, repository } = service();
		const cardId = await cards.create();
		expect(cardId).toBe("card-1");
		expect(repository.pendingCommands).toEqual(["cards.create"]);
		const card = await cards.get(cardId);
		expect(card?.title).toBe("New card");
	});

	test("updates content, bumps the version and rejects stale writes", async () => {
		const { cards } = service();
		const cardId = await cards.create();
		const content = textToCardContent("Research notes\nSecond line");
		const version = await cards.updateContent({
			cardId,
			content,
			expectedVersion: 1,
		});
		expect(version).toBe(2);
		const card = await cards.get(cardId);
		expect(card?.title).toBe("Research notes");
		expect(card?.preview).toBe("Research notes\nSecond line");
		await expect(
			cards.updateContent({
				cardId,
				content: textToCardContent("Stale"),
				expectedVersion: 1,
			}),
		).rejects.toThrow("Card was updated elsewhere");
	});

	test("skips a no-op write instead of creating a change", async () => {
		const { cards, repository } = service();
		const cardId = await cards.create();
		const card = await cards.get(cardId);
		const version = await cards.updateContent({
			cardId,
			content: card?.content,
		});
		expect(version).toBe(1);
		expect(repository.pendingCommands).toEqual(["cards.create"]);
	});

	test("tombstones a card so it leaves every read path", async () => {
		const { cards, repository } = service();
		const cardId = await cards.create();
		await cards.delete(cardId);
		expect(repository.pendingCommands).toEqual([
			"cards.create",
			"cards.delete",
		]);
		expect(await cards.get(cardId)).toBeNull();
		expect(await cards.list()).toEqual([]);
		await expect(cards.delete(cardId)).resolves.toBeUndefined();
	});

	test("searches and sorts consistently", async () => {
		const { cards } = service();
		const first = await cards.create();
		const second = await cards.create();
		await cards.updateContent({
			cardId: first,
			content: textToCardContent("Alpha topic"),
		});
		await cards.updateContent({
			cardId: second,
			content: textToCardContent("Beta topic"),
		});
		expect(
			(await cards.list({ sortBy: "title" })).map((row) => row.title),
		).toEqual(["Alpha topic", "Beta topic"]);
		expect(
			(await cards.list({ sortBy: "title_desc" })).map((row) => row.title),
		).toEqual(["Beta topic", "Alpha topic"]);
		expect(
			(await cards.list({ sortBy: "updated_desc" })).map((row) => row.title),
		).toEqual(["Beta topic", "Alpha topic"]);
		expect(
			(await cards.list({ searchTerm: "alpha" })).map((row) => row.title),
		).toEqual(["Alpha topic"]);
	});

	test("rejects operations outside the allowlist", async () => {
		const { repository } = service();
		await expect(
			repository.query({ type: "secrets.list", input: {} }),
		).rejects.toThrow("not supported");
		await expect(
			repository.execute({ type: "cards.drop", input: {} }),
		).rejects.toThrow("not supported");
	});
});

describe("card metadata derivation", () => {
	test("matches the Web derivation rules", () => {
		expect(
			deriveCardMetadata({
				type: "doc",
				content: [
					{
						type: "heading",
						content: [{ type: "text", text: "  Title   here " }],
					},
					{ type: "paragraph", content: [{ type: "text", text: "Body" }] },
				],
			}),
		).toEqual({
			derivedTitle: "Title here",
			plainText: "Title here\nBody",
			preview: "Title here\nBody",
		});
	});

	test("falls back to a stable title for empty content", () => {
		expect(deriveCardMetadata({ type: "doc", content: [] }).derivedTitle).toBe(
			"Untitled card",
		);
	});
});

describe("card placement and reference capabilities", () => {
	const board = async (
		repository: ReturnType<typeof service>["repository"],
	) => {
		const whiteboards = createRepositoryWhiteboardsService(repository, {
			createId: () => "board-1",
		});
		return whiteboards.createRoot();
	};

	test("appends a card once and reports an existing placement as not created", async () => {
		const { cards, repository } = service();
		const whiteboardId = await board(repository);
		const cardId = await cards.create();

		const first = await cards.appendToWhiteboard({ cardId, whiteboardId });
		expect(first).toMatchObject({ cardId, whiteboardId, created: true });
		expect((await cards.get(cardId))?.activePlacementCount).toBe(1);

		const second = await cards.appendToWhiteboard({ cardId, whiteboardId });
		expect(second).toMatchObject({
			itemId: first?.itemId,
			created: false,
		});
		expect((await cards.get(cardId))?.activePlacementCount).toBe(1);
	});

	test("bulk append places every card and returns one result per card", async () => {
		const { cards, repository } = service();
		const whiteboardId = await board(repository);
		const first = await cards.create();
		const second = await cards.create();
		const placements = await cards.appendManyToWhiteboard({
			cardIds: [first, second],
			whiteboardId,
		});
		expect(placements.map((row) => row.cardId)).toEqual([first, second]);
		expect(new Set(placements.map((row) => row.shapeId)).size).toBe(2);
	});

	test("honours an explicit frame, including the origin", async () => {
		const { cards, repository } = service();
		const whiteboardId = await board(repository);
		const cardId = await cards.create();
		await cards.appendToWhiteboard({
			cardId,
			whiteboardId,
			x: 0,
			y: 0,
			w: 320,
			h: 240,
		});
		const items = await listRows(repository, "items");
		expect(items[0]).toMatchObject({ x: 0, y: 0, w: 320, h: 240 });
	});

	test("auto-places appended cards clear of one another", async () => {
		const { cards, repository } = service();
		const whiteboardId = await board(repository);
		const first = await cards.create();
		const second = await cards.create();
		await cards.appendManyToWhiteboard({
			cardIds: [first, second],
			whiteboardId,
		});
		const items = (await listRows(repository, "items")) as unknown as Array<{
			x: number;
			y: number;
		}>;
		expect(items).toHaveLength(2);
		// Whatever the layout picks, the two must not share a position.
		expect(items[0].x !== items[1].x || items[0].y !== items[1].y).toBe(true);
	});

	test("deleteMany archives every card and its placements", async () => {
		const { cards, repository } = service();
		const whiteboardId = await board(repository);
		const first = await cards.create();
		const second = await cards.create();
		await cards.appendManyToWhiteboard({
			cardIds: [first, second],
			whiteboardId,
		});
		await cards.deleteMany([first, second]);
		expect(await cards.list()).toEqual([]);
		expect(await cards.get(first)).toBeNull();
		await expect(cards.deleteMany([])).resolves.toBeUndefined();
	});

	test("orphanOnly hides placed cards", async () => {
		const { cards, repository } = service();
		const whiteboardId = await board(repository);
		const placed = await cards.create();
		const orphan = await cards.create();
		await cards.appendToWhiteboard({ cardId: placed, whiteboardId });
		expect(
			(await cards.list({ orphanOnly: true })).map((row) => row.id),
		).toEqual([orphan]);
	});

	test("search excludes the current card and honours the limit", async () => {
		const { cards } = service();
		const source = await cards.create({
			content: textToCardContent("Source card"),
		});
		const target = await cards.create({
			content: textToCardContent("Target card"),
		});
		expect(
			(await cards.search({ query: "card" })).map((row) => row.id),
		).toEqual([target, source]);
		expect(
			(await cards.search({ query: "card", excludeCardId: source })).map(
				(row) => row.id,
			),
		).toEqual([target]);
		expect(await cards.search({ query: "card", limit: 1 })).toHaveLength(1);
		expect(await cards.search({ query: "no-such-term" })).toEqual([]);
	});

	test("a card reference in content becomes a backlink on the target", async () => {
		const { cards } = service();
		const target = await cards.create({
			content: textToCardContent("Target card"),
		});
		const source = await cards.create();
		await cards.updateContent({
			cardId: source,
			content: {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "Target card",
								marks: [{ type: "cardReference", attrs: { cardId: target } }],
							},
						],
					},
				],
			},
		});
		expect(
			(await cards.get(target))?.backlinks.map((row) => row.cardId),
		).toEqual([source]);

		// Removing the reference removes the backlink.
		await cards.updateContent({
			cardId: source,
			content: textToCardContent("No more link"),
		});
		expect(await cards.get(target).then((row) => row?.backlinks)).toEqual([]);
	});
});

describe("batched card detail reads", () => {
	/**
	 * Builds a board holding `count` placed cards, each of which is referenced by
	 * one other card so every detail carries placements, breadcrumbs and a
	 * backlink.
	 */
	const fixture = async (count: number) => {
		const { cards, repository } = service();
		const whiteboards = createRepositoryWhiteboardsService(repository, {
			createId: () => "board-1",
		});
		const whiteboardId = await whiteboards.createRoot();
		const targets: string[] = [];
		for (let index = 0; index < count; index += 1) {
			const target = await cards.create({
				content: textToCardContent(`Target ${index}`),
			});
			const source = await cards.create({
				content: textToCardContent(`Source ${index}`),
			});
			await cards.updateContent({
				cardId: source,
				content: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: `Target ${index}`,
									marks: [{ type: "cardReference", attrs: { cardId: target } }],
								},
							],
						},
					],
				},
			});
			targets.push(target);
		}
		await cards.appendManyToWhiteboard({ cardIds: targets, whiteboardId });
		return { cards, repository, targets };
	};

	test("getMany matches per-card get, in the requested order", async () => {
		const { cards, targets } = await fixture(3);
		const ids = [targets[2], targets[0], "missing", targets[1]];

		const batched = await cards.getMany(ids);
		const individually = await Promise.all(ids.map((id) => cards.get(id)));

		expect(batched).toEqual(individually);
		expect(batched.map((row) => row?.id ?? null)).toEqual([
			targets[2],
			targets[0],
			null,
			targets[1],
		]);
		// The fixture is only meaningful if it actually exercises each branch.
		expect(batched[0]?.backlinks).toHaveLength(1);
		expect(batched[0]?.placements).toHaveLength(1);
		expect(batched[0]?.breadcrumbs).toHaveLength(1);
	});

	test("getMany issues a constant number of reads regardless of card count", async () => {
		const small = await fixture(2);
		small.repository.queryLog.length = 0;
		await small.cards.getMany(small.targets);

		const large = await fixture(12);
		large.repository.queryLog.length = 0;
		await large.cards.getMany(large.targets);

		expect(large.repository.queryLog.length).toBe(
			small.repository.queryLog.length,
		);
		// cards(by id), items, cardReferences, whiteboards, backlink sources.
		expect(large.repository.queryLog.map((query) => query.type)).toEqual([
			"cards.list",
			"items.list",
			"cardReferences.list",
			"whiteboards.list",
			"cards.list",
		]);
	});

	test("getMany never reads the whole card table", async () => {
		const { cards, repository, targets } = await fixture(3);
		repository.queryLog.length = 0;
		await cards.getMany(targets);
		// Card rows carry their full content, so every card read must be scoped
		// to a known set of ids.
		const unscoped = repository.queryLog.filter(
			(query) =>
				query.type === "cards.list" &&
				!Array.isArray((query.input as { ids?: unknown } | undefined)?.ids),
		);
		expect(unscoped).toEqual([]);
	});

	test("getMany of nothing reads nothing", async () => {
		const { cards, repository } = await fixture(1);
		repository.queryLog.length = 0;
		expect(await cards.getMany([])).toEqual([]);
		expect(repository.queryLog).toEqual([]);
	});
});

describe("recovering cards stored with a serialized document", () => {
	test("reads a double-encoded row back as a document", async () => {
		// Rows written before restore/adopt learned to parse the canvas's
		// serialized props hold the document as a string, which renders blank.
		const { repository, cards } = service();
		const document = {
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "體驗式學習" }],
				},
			],
		};
		const cardId = await cards.create({ content: document });
		const row = await repository.query<Record<string, unknown>>({
			type: "cards.get",
			input: { id: cardId },
		});
		await repository.execute({
			type: "cards.update",
			input: { value: { ...row, content: JSON.stringify(document) } },
		});

		expect((await cards.get(cardId))?.content).toEqual(document);
	});

	test("keeps an unparseable row usable instead of rendering nothing", async () => {
		const { repository, cards } = service();
		const cardId = await cards.create();
		const row = await repository.query<Record<string, unknown>>({
			type: "cards.get",
			input: { id: cardId },
		});
		await repository.execute({
			type: "cards.update",
			input: { value: { ...row, content: "<<corrupt>>" } },
		});

		const detail = await cards.get(cardId);
		expect(detail?.content).toEqual({
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "New card" }],
				},
			],
		});
	});
});
