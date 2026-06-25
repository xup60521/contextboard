import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

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
			const cards = await ctx.db
				.query("cards")
				.withIndex("by_whiteboard_archived_updated", (q) =>
					q.eq("whiteboardId", args.whiteboardId).eq("archivedAt", null),
				)
				.order("desc")
				.take(MAX_RESULTS_PER_KIND);

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
				q
					.search("plainText", term)
					.eq("archivedAt", null)
					.eq("whiteboardId", args.whiteboardId),
			)
			.take(MAX_RESULTS_PER_KIND);

		const whiteboards = await ctx.db
			.query("whiteboards")
			.withSearchIndex("search_title", (q) =>
				q
					.search("title", term)
					.eq("archivedAt", null)
					.eq("parentWhiteboardId", args.whiteboardId),
			)
			.take(MAX_RESULTS_PER_KIND);

		return await enrichResults(ctx, cards, whiteboards);
	},
});

async function enrichResults(
	ctx: QueryCtx,
	cards: Doc<"cards">[],
	whiteboards: Doc<"whiteboards">[],
): Promise<SearchResults> {
	const cardResults = await Promise.all(
		cards.map(async (card): Promise<CardSearchResult> => {
			const item = await ctx.db
				.query("boardItems")
				.withIndex("by_card", (q) => q.eq("cardId", card._id))
				.filter((q) => q.eq(q.field("archivedAt"), null))
				.first();
			return {
				kind: "card",
				id: card._id,
				title: card.derivedTitle,
				preview: card.preview,
				content: card.content,
				boardWhiteboardId: item?.whiteboardId ?? card.whiteboardId,
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
