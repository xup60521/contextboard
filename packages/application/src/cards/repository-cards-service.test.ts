import { describe, expect, test } from "vitest";
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
