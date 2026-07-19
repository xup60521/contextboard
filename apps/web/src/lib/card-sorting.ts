import type { Id } from "#/integrations/local/types";
export const CARD_SORT_OPTIONS = ["title", "title_desc", "updated", "updated_asc"] as const;
export type CardSortBy = (typeof CARD_SORT_OPTIONS)[number];
export const DEFAULT_CARD_SORT_BY: CardSortBy = "updated";
export const CARD_SORT_LABELS: Record<CardSortBy, string> = { title: "Title A-Z", title_desc: "Title Z-A", updated: "Recently updated", updated_asc: "Least recently updated" };
export function isCardSortBy(value: unknown): value is CardSortBy { return typeof value === "string" && CARD_SORT_OPTIONS.includes(value as CardSortBy); }
export function getCardSortLabel(sortBy: CardSortBy) { return CARD_SORT_LABELS[sortBy]; }
type SortableCard = { _id: Id<"cards">; _creationTime: number; derivedTitle: string; updatedAt: number };
const fallback = (a: SortableCard, b: SortableCard) => b.updatedAt - a.updatedAt || b._creationTime - a._creationTime || a.derivedTitle.localeCompare(b.derivedTitle) || `${a._id}`.localeCompare(`${b._id}`);
export function sortCards<T extends SortableCard>(cards: readonly T[], sortBy: CardSortBy = DEFAULT_CARD_SORT_BY): T[] { return [...cards].sort((a, b) => { switch (sortBy) { case "title": return a.derivedTitle.localeCompare(b.derivedTitle) || fallback(a, b); case "title_desc": return b.derivedTitle.localeCompare(a.derivedTitle) || fallback(a, b); case "updated_asc": return a.updatedAt - b.updatedAt || fallback(a, b); default: return fallback(a, b); } }); }
