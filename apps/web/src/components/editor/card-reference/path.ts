/**
 * Canonical form of a card-reference link target. Kept in sync with the backend
 * `convex/model/cardReferences.ts` helpers (duplicated here so the editor bundle
 * stays free of Convex server imports).
 */
export const CARD_PATH_PREFIX = "/cards/";

export function cardHref(cardId: string): string {
	return `${CARD_PATH_PREFIX}${cardId}`;
}

/** Extracts a card id from an internal `/cards/<id>` href, or null otherwise. */
export function parseCardIdFromHref(
	href: string | null | undefined,
): string | null {
	if (typeof href !== "string") return null;
	if (!href.startsWith(CARD_PATH_PREFIX)) return null;
	const id = href.slice(CARD_PATH_PREFIX.length);
	if (!id || id.includes("/") || id.includes("#") || id.includes("?")) {
		return null;
	}
	return id;
}
