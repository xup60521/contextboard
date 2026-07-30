export const CARD_SORT_OPTIONS = ["title", "title_desc", "updated", "updated_asc"] as const;
export type CardSortBy = (typeof CARD_SORT_OPTIONS)[number];
export const DEFAULT_CARD_SORT_BY: CardSortBy = "updated";
export function isCardSortBy(value: unknown): value is CardSortBy { return typeof value === "string" && CARD_SORT_OPTIONS.includes(value as CardSortBy); }
