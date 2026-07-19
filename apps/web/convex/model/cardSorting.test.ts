import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
	CARD_SORT_OPTIONS,
	DEFAULT_CARD_SORT_BY,
	getCardSortLabel,
	sortCards,
} from "./cardSorting";

type SortableCard = Pick<
	Doc<"cards">,
	"_id" | "_creationTime" | "derivedTitle" | "updatedAt"
>;

function makeCard(
	id: string,
	title: string,
	creationTime: number,
	updatedAt: number,
): SortableCard {
	return {
		_id: id as Id<"cards">,
		_creationTime: creationTime,
		derivedTitle: title,
		updatedAt,
	};
}

const CARDS = [
	makeCard("card-c", "Charlie", 30, 40),
	makeCard("card-a", "Alpha", 10, 50),
	makeCard("card-b", "Alpha", 10, 40),
	makeCard("card-d", "Bravo", 20, 30),
] as const;

describe("card sorting metadata", () => {
	test("exposes a label for each sort option", () => {
		expect(CARD_SORT_OPTIONS.map((option) => getCardSortLabel(option))).toEqual([
			"Title A-Z",
			"Title Z-A",
			"Recently updated",
			"Least recently updated",
		]);
	});
});

describe("sortCards", () => {
	test("defaults to recently-updated ordering", () => {
		expect(sortCards(CARDS).map((card) => card._id)).toEqual([
			"card-a",
			"card-c",
			"card-b",
			"card-d",
		]);
		expect(DEFAULT_CARD_SORT_BY).toBe("updated");
	});

	test("sorts title ascending and descending", () => {
		expect(sortCards(CARDS, "title").map((card) => card._id)).toEqual([
			"card-a",
			"card-b",
			"card-d",
			"card-c",
		]);
		expect(sortCards(CARDS, "title_desc").map((card) => card._id)).toEqual([
			"card-c",
			"card-d",
			"card-a",
			"card-b",
		]);
	});

	test("sorts by updated time in both directions", () => {
		expect(sortCards(CARDS, "updated").map((card) => card._id)).toEqual([
			"card-a",
			"card-c",
			"card-b",
			"card-d",
		]);
		expect(sortCards(CARDS, "updated_asc").map((card) => card._id)).toEqual([
			"card-d",
			"card-c",
			"card-b",
			"card-a",
		]);
	});

	test("breaks ties deterministically", () => {
		const tied = [
			makeCard("card-b", "Same", 10, 10),
			makeCard("card-a", "Same", 10, 10),
		];

		expect(sortCards(tied).map((card) => card._id)).toEqual([
			"card-a",
			"card-b",
		]);
	});
});
