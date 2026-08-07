import { describe, expect, test } from "vitest";
import { textToCardContent } from "../cards/card-content";
import { createRepositoryCardsService } from "../cards/repository-cards-service";
import { createMemoryWorkspaceRepository } from "../testing";
import { createRepositorySearchService } from "./repository-search-service";

describe("repository search performance", () => {
	test("loads documents and placements only for the limited card results", async () => {
		let id = 0;
		const repository = createMemoryWorkspaceRepository();
		const cards = createRepositoryCardsService(repository, {
			createId: () => `card-${++id}`,
		});
		for (const title of ["Alpha", "Beta", "Gamma"])
			await cards.create({ content: textToCardContent(title) });
		repository.queryLog.length = 0;

		const results = await createRepositorySearchService(repository).search({
			term: "",
			limit: 2,
		});

		expect(results.cards).toHaveLength(2);
		expect(repository.queryLog).toContainEqual({
			type: "cardContents.list",
			input: { cardIds: results.cards.map((card) => card.id) },
		});
		expect(
			repository.queryLog.filter((query) => query.type === "items.list"),
		).toEqual([
			{
				type: "items.list",
				input: { cardIds: results.cards.map((card) => card.id) },
			},
		]);
	});

	test("scopes board search before reading cards", async () => {
		const repository = createMemoryWorkspaceRepository();
		await repository.execute({
			type: "items.create",
			input: {
				value: {
					id: "item-1",
					whiteboardId: "board-1",
					cardId: "card-1",
					childWhiteboardId: null,
					archivedAt: null,
				},
			},
		});
		repository.queryLog.length = 0;

		await createRepositorySearchService(repository).search({
			term: "",
			whiteboardId: "board-1",
		});

		expect(repository.queryLog[0]).toEqual({
			type: "items.list",
			input: { whiteboardId: "board-1" },
		});
		expect(repository.queryLog).toContainEqual({
			type: "cards.list",
			input: { ids: ["card-1"] },
		});
	});
});
