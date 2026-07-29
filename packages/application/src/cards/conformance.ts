import type { CardsService } from "../runtime";
import { textToCardContent } from "./card-content";

/**
 * Backend-agnostic card conformance suite.
 *
 * IndexedDB (Web) and SQLite (Desktop) must satisfy every case identically:
 * same shapes, same revision/version semantics, same tombstone visibility.
 * Exported as plain assertions so each backend's own test runner can drive it
 * without this package depending on a test framework.
 */
export type ConformanceCase = {
	name: string;
	run: (cards: CardsService) => Promise<void>;
};

class ConformanceError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new ConformanceError(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	assert(a === b, `${message}\n  expected: ${b}\n  actual:   ${a}`);
}

async function assertRejects(promise: Promise<unknown>, message: string) {
	let rejected = false;
	try {
		await promise;
	} catch {
		rejected = true;
	}
	assert(rejected, message);
}

export const cardsServiceConformance: ConformanceCase[] = [
	{
		name: "creates a card with the shared default title and version 1",
		async run(cards) {
			const cardId = await cards.create();
			const card = await cards.get(cardId);
			assert(card, "A created card must be readable");
			assertEqual(card.title, "New card", "Default title must be shared");
			assertEqual(card.version, 1, "A new card starts at version 1");
			assertEqual(
				card.activePlacementCount,
				0,
				"A newly created card starts as an orphan",
			);
			assert(
				(await cards.list()).some((row) => row.id === cardId),
				"A newly created orphan must appear in the card list",
			);
			assert(card.createdAt > 0, "createdAt must be populated");
			assert(card.updatedAt > 0, "updatedAt must be populated");
		},
	},
	{
		name: "derives title and preview identically from content",
		async run(cards) {
			const cardId = await cards.create({
				content: textToCardContent("Shared title\nBody text"),
			});
			const card = await cards.get(cardId);
			assert(card, "A created card must be readable");
			assertEqual(card.title, "Shared title", "Title derivation must match");
			assertEqual(
				card.preview,
				"Shared title\nBody text",
				"Preview derivation must match",
			);
		},
	},
	{
		name: "bumps the version on every content change",
		async run(cards) {
			const cardId = await cards.create();
			assertEqual(
				await cards.updateContent({
					cardId,
					content: textToCardContent("First"),
				}),
				2,
				"The first edit produces version 2",
			);
			assertEqual(
				await cards.updateContent({
					cardId,
					content: textToCardContent("Second"),
				}),
				3,
				"The second edit produces version 3",
			);
		},
	},
	{
		name: "treats an identical write as a no-op",
		async run(cards) {
			const cardId = await cards.create();
			const card = await cards.get(cardId);
			assert(card, "A created card must be readable");
			assertEqual(
				await cards.updateContent({ cardId, content: card.content }),
				card.version,
				"Rewriting identical content must not bump the version",
			);
		},
	},
	{
		name: "rejects a stale expected version",
		async run(cards) {
			const cardId = await cards.create();
			await cards.updateContent({
				cardId,
				content: textToCardContent("Changed"),
				expectedVersion: 1,
			});
			await assertRejects(
				cards.updateContent({
					cardId,
					content: textToCardContent("Stale"),
					expectedVersion: 1,
				}),
				"A stale expected version must be rejected",
			);
		},
	},
	{
		name: "rejects writes to a missing card",
		async run(cards) {
			await assertRejects(
				cards.updateContent({
					cardId: "missing-card",
					content: textToCardContent("Nope"),
				}),
				"Writing to a missing card must be rejected",
			);
		},
	},
	{
		name: "removes a tombstoned card from every read path",
		async run(cards) {
			const cardId = await cards.create();
			await cards.delete(cardId);
			assertEqual(
				await cards.get(cardId),
				null,
				"A deleted card reads as null",
			);
			assertEqual(
				(await cards.list()).filter((row) => row.id === cardId),
				[],
				"A deleted card must leave the list",
			);
			await cards.delete(cardId);
		},
	},
	{
		name: "sorts and searches identically",
		async run(cards) {
			const alpha = await cards.create({
				content: textToCardContent("Alpha topic"),
			});
			const beta = await cards.create({
				content: textToCardContent("Beta topic"),
			});
			assertEqual(
				(await cards.list({ sortBy: "title" }))
					.filter((row) => row.id === alpha || row.id === beta)
					.map((row) => row.title),
				["Alpha topic", "Beta topic"],
				"Title sorting must match",
			);
			assertEqual(
				(await cards.list({ sortBy: "title_desc" }))
					.filter((row) => row.id === alpha || row.id === beta)
					.map((row) => row.title),
				["Beta topic", "Alpha topic"],
				"Reverse title sorting must match",
			);
			assertEqual(
				(await cards.list({ searchTerm: "alpha" })).map((row) => row.title),
				["Alpha topic"],
				"Search must match on title and text",
			);
			assertEqual(
				await cards.list({ searchTerm: "no-such-term" }),
				[],
				"An unmatched search returns nothing",
			);
		},
	},
];
