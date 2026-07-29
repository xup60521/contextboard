import "fake-indexeddb/auto";
import {
	cardsServiceConformance,
	createRepositoryCardsService,
} from "@contextboard/application/cards";
import { afterEach, describe, expect, test } from "vitest";
import {
	createContextboardDatabase,
	IndexedDbWorkspaceRepository,
} from "./index";

const databases: Array<ReturnType<typeof createContextboardDatabase>> = [];

function makeCards() {
	const database = createContextboardDatabase(crypto.randomUUID());
	databases.push(database);
	const repository = new IndexedDbWorkspaceRepository(database);
	return {
		database,
		repository,
		cards: createRepositoryCardsService(repository),
	};
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("IndexedDB card conformance", () => {
	for (const scenario of cardsServiceConformance) {
		test(scenario.name, async () => {
			await scenario.run(makeCards().cards);
		});
	}

	test("writes the local mutation and its pending batch atomically", async () => {
		const { cards, repository } = makeCards();
		const cardId = await cards.create();
		const pending = await repository.getPendingBatches(10);
		expect(pending).toHaveLength(1);
		expect(pending[0]?.command).toBe("cards.create");
		expect(pending[0]?.changes[0]).toMatchObject({
			entityType: "card",
			entityId: cardId,
			baseRevision: null,
			revision: 1,
			operation: "upsert",
		});
	});

	test("emits a delete change for a tombstoned card", async () => {
		const { cards, repository } = makeCards();
		const cardId = await cards.create();
		await cards.delete(cardId);
		const pending = await repository.getPendingBatches(10);
		expect(pending.map((batch) => batch.command)).toEqual([
			"cards.create",
			"cards.delete",
		]);
		expect(pending[1]?.changes[0]).toMatchObject({
			entityType: "card",
			entityId: cardId,
			baseRevision: 1,
			revision: 2,
			operation: "delete",
		});
	});

	test("survives a close and reopen of the database", async () => {
		const name = crypto.randomUUID();
		const first = createContextboardDatabase(name);
		databases.push(first);
		const cardId = await createRepositoryCardsService(
			new IndexedDbWorkspaceRepository(first),
		).create({ content: { type: "doc", content: [] } });
		await first.close();

		const second = createContextboardDatabase(name);
		databases.push(second);
		const reopened = await createRepositoryCardsService(
			new IndexedDbWorkspaceRepository(second),
		).get(cardId);
		expect(reopened?.id).toBe(cardId);
	});

	test("rejects operations outside the allowlist", async () => {
		const { repository } = makeCards();
		await expect(
			repository.query({ type: "secrets.list", input: {} }),
		).rejects.toThrow(/not supported/);
		await expect(
			repository.execute({ type: "cards.drop", input: { value: { id: "a" } } }),
		).rejects.toThrow(/not supported/);
		await expect(
			repository.execute({ type: "cards.create", input: {} }),
		).rejects.toThrow(/valid entity ID/);
	});
});
