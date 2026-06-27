import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export const CARD_SORT_OPTIONS = [
	"title",
	"title_desc",
	"created",
	"created_asc",
	"updated",
	"updated_asc",
] as const;

export type CardSortBy = (typeof CARD_SORT_OPTIONS)[number];

export const DEFAULT_CARD_SORT_BY: CardSortBy = "created";

export const CARD_SORT_LABELS: Record<CardSortBy, string> = {
	title: "Title A-Z",
	title_desc: "Title Z-A",
	created: "Newest first",
	created_asc: "Oldest first",
	updated: "Recently updated",
	updated_asc: "Least recently updated",
};

export const cardSortByValidator = v.union(
	v.literal("title"),
	v.literal("title_desc"),
	v.literal("created"),
	v.literal("created_asc"),
	v.literal("updated"),
	v.literal("updated_asc"),
);

export function isCardSortBy(value: unknown): value is CardSortBy {
	return typeof value === "string" && CARD_SORT_OPTIONS.includes(value as CardSortBy);
}

export function getCardSortLabel(sortBy: CardSortBy) {
	return CARD_SORT_LABELS[sortBy];
}

type SortableCard = Pick<
	Doc<"cards">,
	"_id" | "_creationTime" | "derivedTitle" | "updatedAt"
>;

function compareNumberDesc(left: number, right: number) {
	return right - left;
}

function compareNumberAsc(left: number, right: number) {
	return left - right;
}

function compareStringAsc(left: string, right: string) {
	return left.localeCompare(right);
}

function compareStringDesc(left: string, right: string) {
	return right.localeCompare(left);
}

function compareCardIdentity(left: SortableCard, right: SortableCard) {
	return `${left._id}`.localeCompare(`${right._id}`);
}

function compareCardFallback(left: SortableCard, right: SortableCard) {
	return (
		compareNumberDesc(left.updatedAt, right.updatedAt) ||
		compareNumberDesc(left._creationTime, right._creationTime) ||
		compareStringAsc(left.derivedTitle, right.derivedTitle) ||
		compareCardIdentity(left, right)
	);
}

export function sortCards<T extends SortableCard>(
	cards: readonly T[],
	sortBy: CardSortBy = DEFAULT_CARD_SORT_BY,
): T[] {
	return cards.toSorted((left, right) => {
		switch (sortBy) {
			case "title":
				return (
					compareStringAsc(left.derivedTitle, right.derivedTitle) ||
					compareCardFallback(left, right)
				);
			case "title_desc":
				return (
					compareStringDesc(left.derivedTitle, right.derivedTitle) ||
					compareCardFallback(left, right)
				);
			case "created_asc":
				return (
					compareNumberAsc(left._creationTime, right._creationTime) ||
					compareCardFallback(left, right)
				);
			case "updated":
				return (
					compareNumberDesc(left.updatedAt, right.updatedAt) ||
					compareCardFallback(left, right)
				);
			case "updated_asc":
				return (
					compareNumberAsc(left.updatedAt, right.updatedAt) ||
					compareCardFallback(left, right)
				);
			case "created":
			default:
				return (
					compareNumberDesc(left._creationTime, right._creationTime) ||
					compareCardFallback(left, right)
				);
		}
	});
}
