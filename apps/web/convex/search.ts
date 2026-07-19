import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
	getPreferredPlacement,
	hasActivePlacementOnBoard,
} from "./model/cardPlacements";
import {
	collectCardReferenceIds,
	fetchCardTitles,
	resolveCardReferenceTitles,
} from "./model/cardReferences";

const MAX_RESULTS_PER_KIND = 8;

export type CardSearchResult = {
	kind: "card";
	id: Id<"cards">;
	title: string;
	preview: string;
	/** Full TipTap JSON, so the preview pane renders without a second fetch. */
	content: unknown;
	/** The whiteboard whose canvas holds this card's shape (for navigate & focus). */
	boardWhiteboardId: Id<"whiteboards"> | null;
	/** The tldraw shape id of this card on its board, if placed. */
	shapeId: string | null;
};

export type WhiteboardSearchResult = {
	kind: "whiteboard";
	id: Id<"whiteboards">;
	title: string;
	/** The parent board whose canvas holds this whiteboard's frame (for navigate & focus). */
	boardWhiteboardId: Id<"whiteboards"> | null;
	/** The tldraw shape id of this whiteboard's frame on its parent board, if placed. */
	shapeId: string | null;
};

export type SearchResults = {
	cards: CardSearchResult[];
	whiteboards: WhiteboardSearchResult[];
};

/** A card suggestion offered when typing `@` inside a card editor. */
export type CardReferenceSuggestion = {
	id: Id<"cards">;
	title: string;
	preview: string;
	/** The whiteboard whose canvas holds this card's shape (for navigate & focus). */
	boardWhiteboardId: Id<"whiteboards"> | null;
	/** The tldraw shape id of this card on its board, if placed. */
	shapeId: string | null;
};

export const searchGlobal = query({
	args: { term: v.string() },
	handler: async (ctx, args): Promise<SearchResults> => {
		const term = args.term.trim();
		if (term.length === 0) {
			return { cards: [], whiteboards: [] };
		}

		const cards = await ctx.db
			.query("cards")
			.withSearchIndex("search_text", (q) =>
				q.search("plainText", term).eq("archivedAt", null),
			)
			.take(MAX_RESULTS_PER_KIND);

		const whiteboards = await ctx.db
			.query("whiteboards")
			.withSearchIndex("search_title", (q) =>
				q.search("title", term).eq("archivedAt", null),
			)
			.take(MAX_RESULTS_PER_KIND);

		return await enrichResults(ctx, cards, whiteboards);
	},
});

export const searchInWhiteboard = query({
	args: {
		whiteboardId: v.id("whiteboards"),
		term: v.string(),
	},
	handler: async (ctx, args): Promise<SearchResults> => {
		const term = args.term.trim();

		if (term.length === 0) {
			// Empty query: fall back to the board's most recent cards and its
			// direct children so the palette is useful before the user types.
			const cards = await listCardsInWhiteboard(ctx, args.whiteboardId);

			const whiteboards = await ctx.db
				.query("whiteboards")
				.withIndex("by_parent_archived_sort", (q) =>
					q
						.eq("parentWhiteboardId", args.whiteboardId)
						.eq("archivedAt", null),
				)
				.take(MAX_RESULTS_PER_KIND);

			return await enrichResults(ctx, cards, whiteboards);
		}

		const cards = await ctx.db
			.query("cards")
			.withSearchIndex("search_text", (q) =>
				q.search("plainText", term).eq("archivedAt", null),
			)
			.take(MAX_RESULTS_PER_KIND * 4);
		const filteredCards: Doc<"cards">[] = [];
		for (const card of cards) {
			if (await hasActivePlacementOnBoard(ctx, card._id, args.whiteboardId)) {
				filteredCards.push(card);
			}
			if (filteredCards.length >= MAX_RESULTS_PER_KIND) {
				break;
			}
		}

		const whiteboards = await ctx.db
			.query("whiteboards")
			.withSearchIndex("search_title", (q) =>
				q
					.search("title", term)
					.eq("archivedAt", null)
					.eq("parentWhiteboardId", args.whiteboardId),
			)
			.take(MAX_RESULTS_PER_KIND);

		return await enrichResults(ctx, filteredCards, whiteboards);
	},
});

export const searchCardsForReference = query({
	args: {
		term: v.string(),
		whiteboardId: v.optional(v.id("whiteboards")),
	},
	handler: async (ctx, args): Promise<CardReferenceSuggestion[]> => {
		const term = args.term.trim();
		const whiteboardId = args.whiteboardId;

		let cards: Doc<"cards">[];
		if (term.length > 0) {
			// Non-empty query: search globally across all cards.
			cards = await ctx.db
				.query("cards")
				.withSearchIndex("search_text", (q) =>
					q.search("plainText", term).eq("archivedAt", null),
				)
				.take(MAX_RESULTS_PER_KIND);
		} else if (whiteboardId) {
			// Empty query with whiteboard context: recent cards from that board.
			cards = await listCardsInWhiteboard(ctx, whiteboardId);
		} else {
			// Empty query with no context: nothing to suggest.
			return [];
		}

		return await Promise.all(
			cards.map(async (card): Promise<CardReferenceSuggestion> => {
				const item = await getPreferredPlacement(ctx, card._id, whiteboardId);
				return {
					id: card._id,
					title: card.derivedTitle,
					preview: card.preview,
					boardWhiteboardId: item?.whiteboardId ?? null,
					shapeId: item?.shapeId ?? null,
				};
			}),
		);
	},
});

async function enrichResults(
	ctx: QueryCtx,
	cards: Doc<"cards">[],
	whiteboards: Doc<"whiteboards">[],
): Promise<SearchResults> {
	const cardResults = await Promise.all(
		cards.map(async (card): Promise<CardSearchResult> => {
			const item = await getPreferredPlacement(ctx, card._id);
			const referenceIds = collectCardReferenceIds(card.content);
			const content =
				referenceIds.length > 0
					? resolveCardReferenceTitles(
							card.content,
							await fetchCardTitles(ctx, referenceIds),
						)
					: card.content;
			return {
				kind: "card",
				id: card._id,
				title: card.derivedTitle,
				preview: card.preview,
				content,
				boardWhiteboardId: item?.whiteboardId ?? null,
				shapeId: item?.shapeId ?? null,
			};
		}),
	);

	const whiteboardResults = await Promise.all(
		whiteboards.map(async (whiteboard): Promise<WhiteboardSearchResult> => {
			const item = await ctx.db
				.query("boardItems")
				.withIndex("by_childWhiteboard", (q) =>
					q.eq("childWhiteboardId", whiteboard._id),
				)
				.filter((q) => q.eq(q.field("archivedAt"), null))
				.first();
			return {
				kind: "whiteboard",
				id: whiteboard._id,
				title: whiteboard.title,
				boardWhiteboardId:
					item?.whiteboardId ?? whiteboard.parentWhiteboardId ?? null,
				shapeId: item?.shapeId ?? null,
			};
		}),
	);

	return { cards: cardResults, whiteboards: whiteboardResults };
}

async function listCardsInWhiteboard(
	ctx: QueryCtx,
	whiteboardId: Id<"whiteboards">,
): Promise<Doc<"cards">[]> {
	const placements = await ctx.db
		.query("boardItems")
		.withIndex("by_whiteboard_archived_z", (q) =>
			q.eq("whiteboardId", whiteboardId).eq("archivedAt", null),
		)
		.collect();

	const cardsById = new Map<Id<"cards">, Doc<"cards">>();
	for (const card of (
		await Promise.all(
			placements
				.filter((item) => item.kind === "card" && item.cardId !== null)
				.map(async (item) => (item.cardId ? await ctx.db.get(item.cardId) : null)),
		)
	).filter((card): card is Doc<"cards"> => !!card && card.archivedAt === null)) {
		cardsById.set(card._id, card);
	}

	return [...cardsById.values()]
		.sort((left, right) => right.updatedAt - left.updatedAt)
		.slice(0, MAX_RESULTS_PER_KIND);
}
