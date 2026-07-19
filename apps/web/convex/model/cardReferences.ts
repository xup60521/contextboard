import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Card references are persisted as ordinary TipTap `link` marks carrying extra
 * card metadata. The canonical href is `/cards/<cardId>`; the mark also records
 * whether its visible label tracks the target title (`auto`) or was edited by
 * the user (`custom`), plus the last resolved title for change detection.
 *
 * These helpers are pure (they operate on plain TipTap JSON) so they can be
 * unit-tested without a Convex context. `fetchCardTitles` is the only function
 * that touches the database.
 */

export const CARD_PATH_PREFIX = "/cards/";

type LinkMark = {
	type: string;
	attrs?: Record<string, unknown>;
};

type JsonNode = {
	type?: unknown;
	text?: unknown;
	marks?: LinkMark[];
	attrs?: Record<string, unknown>;
	content?: JsonNode[];
	[key: string]: unknown;
};

export function cardHref(cardId: string): string {
	return `${CARD_PATH_PREFIX}${cardId}`;
}

/** Extracts a card id from an internal `/cards/<id>` href, or null otherwise. */
export function parseCardIdFromHref(href: unknown): string | null {
	if (typeof href !== "string") return null;
	if (!href.startsWith(CARD_PATH_PREFIX)) return null;
	const id = href.slice(CARD_PATH_PREFIX.length);
	if (!id || id.includes("/") || id.includes("#") || id.includes("?")) {
		return null;
	}
	return id;
}

/**
 * Returns the card id a node's link mark points at (via explicit `cardId` attr
 * or a `/cards/<id>` href), or null if the node carries no card reference.
 */
function getReferencedCardId(node: JsonNode): string | null {
	if (!Array.isArray(node.marks)) return null;
	for (const mark of node.marks) {
		if (mark.type !== "link") continue;
		const explicit = mark.attrs?.cardId;
		if (typeof explicit === "string" && explicit.length > 0) {
			return explicit;
		}
		const fromHref = parseCardIdFromHref(mark.attrs?.href);
		if (fromHref) return fromHref;
	}
	return null;
}

function isNode(value: unknown): value is JsonNode {
	return typeof value === "object" && value !== null;
}

function mapNodes(node: JsonNode, fn: (node: JsonNode) => JsonNode): JsonNode {
	const mapped = fn(node);
	if (!Array.isArray(mapped.content)) return mapped;
	return {
		...mapped,
		content: mapped.content.map((child) =>
			isNode(child) ? mapNodes(child, fn) : child,
		),
	};
}

/** Collects the distinct card ids referenced anywhere in a TipTap document. */
export function collectCardReferenceIds(content: unknown): string[] {
	const ids = new Set<string>();
	const visit = (value: unknown) => {
		if (!isNode(value)) return;
		const cardId = getReferencedCardId(value);
		if (cardId) ids.add(cardId);
		if (Array.isArray(value.content)) {
			for (const child of value.content) visit(child);
		}
	};
	visit(content);
	return [...ids];
}

/**
 * Save-time normalization. For every card-reference link mark:
 * - forces `href` to the canonical `/cards/<cardId>` form,
 * - keeps `auto` labels in sync with the target title (and refreshes the stored
 *   `resolvedTitle`), and
 * - flips an `auto` ref to `custom` once the user has edited its visible label.
 *
 * `custom` labels are left untouched. References whose target is missing from
 * `titles` (deleted/archived) are left as-is apart from the href fix.
 */
export function normalizeCardReferences(
	content: unknown,
	titles: Map<string, string>,
): unknown {
	if (!isNode(content)) return content;

	return mapNodes(content, (node) => {
		if (typeof node.text !== "string" || !Array.isArray(node.marks)) {
			return node;
		}
		const cardId = getReferencedCardId(node);
		if (!cardId) return node;

		const currentTitle = titles.get(cardId);
		const nodeText = node.text;

		const marks = node.marks.map((mark) => {
			if (mark.type !== "link") return mark;
			const markCardId =
				typeof mark.attrs?.cardId === "string" && mark.attrs.cardId.length > 0
					? (mark.attrs.cardId as string)
					: parseCardIdFromHref(mark.attrs?.href);
			if (markCardId !== cardId) return mark;

			const attrs: Record<string, unknown> = { ...(mark.attrs ?? {}) };
			attrs.cardId = cardId;
			attrs.href = cardHref(cardId);

			let mode: "auto" | "custom" =
				attrs.cardLabelMode === "auto" ? "auto" : "custom";
			if (mode === "auto") {
				const prevResolved =
					typeof attrs.resolvedTitle === "string" ? attrs.resolvedTitle : null;
				// The user renamed the label out from under us: stop tracking.
				if (prevResolved !== null && nodeText !== prevResolved) {
					mode = "custom";
				}
			}
			attrs.cardLabelMode = mode;
			if (currentTitle !== undefined) {
				attrs.resolvedTitle = currentTitle;
			}
			return { ...mark, attrs };
		});

		// Keep an auto label's visible text aligned with the live target title.
		const isAuto = marks.some(
			(mark) => mark.type === "link" && mark.attrs?.cardLabelMode === "auto",
		);
		const text = isAuto && currentTitle !== undefined ? currentTitle : nodeText;

		return { ...node, marks, text };
	});
}

/**
 * Read-time resolution. Replaces the visible label of every `auto` card
 * reference with the target card's current title so renamed cards show their
 * latest name without requiring the referencing card to be re-saved.
 */
export function resolveCardReferenceTitles(
	content: unknown,
	titles: Map<string, string>,
): unknown {
	if (!isNode(content)) return content;

	return mapNodes(content, (node) => {
		if (typeof node.text !== "string" || !Array.isArray(node.marks)) {
			return node;
		}
		const cardId = getReferencedCardId(node);
		if (!cardId) return node;

		const linkMark = node.marks.find((mark) => {
			if (mark.type !== "link") return false;
			const markCardId =
				typeof mark.attrs?.cardId === "string" && mark.attrs.cardId.length > 0
					? (mark.attrs.cardId as string)
					: parseCardIdFromHref(mark.attrs?.href);
			return markCardId === cardId;
		});
		if (linkMark?.attrs?.cardLabelMode !== "auto") return node;

		const currentTitle = titles.get(cardId);
		if (currentTitle === undefined || currentTitle === node.text) {
			return node;
		}
		return { ...node, text: currentTitle };
	});
}

/**
 * Diffs the outgoing card references for `sourceCardId` against what's stored
 * in the `cardReferences` table and reconciles the difference. Call this
 * whenever a card's content is saved (after normalization).
 */
export async function reconcileCardReferences(
	ctx: MutationCtx,
	sourceCardId: Id<"cards">,
	content: unknown,
) {
	const nextTargetIds = new Set<Id<"cards">>();
	for (const rawId of collectCardReferenceIds(content)) {
		const targetId = ctx.db.normalizeId("cards", rawId);
		if (!targetId || targetId === sourceCardId) continue;
		nextTargetIds.add(targetId);
	}

	const existing = new Map<Id<"cards">, Id<"cardReferences">>();
	for await (const ref of ctx.db
		.query("cardReferences")
		.withIndex("by_sourceCardId", (q) => q.eq("sourceCardId", sourceCardId))) {
		existing.set(ref.targetCardId, ref._id);
	}

	for (const [targetId, refId] of existing) {
		if (!nextTargetIds.has(targetId)) await ctx.db.delete(refId);
	}

	const now = Date.now();
	for (const targetId of nextTargetIds) {
		if (existing.has(targetId)) continue;
		await ctx.db.insert("cardReferences", {
			sourceCardId,
			targetCardId: targetId,
			updatedAt: now,
		});
	}
}

/**
 * Removes all outgoing card reference rows where `sourceCardId` is the source.
 * Call this when a card is archived.
 */
export async function clearCardReferences(
	ctx: MutationCtx,
	sourceCardId: Id<"cards">,
) {
	const toDelete: Id<"cardReferences">[] = [];
	for await (const ref of ctx.db
		.query("cardReferences")
		.withIndex("by_sourceCardId", (q) => q.eq("sourceCardId", sourceCardId))) {
		toDelete.push(ref._id);
	}
	for (const refId of toDelete) {
		await ctx.db.delete(refId);
	}
}

/** Fetches the current titles of the given cards (skipping missing/archived). */
export async function fetchCardTitles(
	ctx: QueryCtx,
	cardIds: string[],
): Promise<Map<string, string>> {
	const titles = new Map<string, string>();
	await Promise.all(
		cardIds.map(async (cardId) => {
			const card = await ctx.db.get(cardId as Id<"cards">);
			if (card && card.archivedAt === null) {
				titles.set(cardId, card.derivedTitle);
			}
		}),
	);
	return titles;
}
