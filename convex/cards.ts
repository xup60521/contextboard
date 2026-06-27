import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { clearCardFileRefs, reconcileCardFileRefs } from "./fileLifecycle";
import { deriveCardMetadata } from "./model/cardMetadata";
import {
	collectCardReferenceIds,
	fetchCardTitles,
	normalizeCardReferences,
	resolveCardReferenceTitles,
} from "./model/cardReferences";

const MAX_CARD_CONTENT_BYTES = 250_000;

export const get = query({
	args: { cardId: v.id("cards") },
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) return null;

		const whiteboard = card.whiteboardId
			? await ctx.db.get(card.whiteboardId)
			: null;

		const breadcrumbs = [];
		if (whiteboard && whiteboard.archivedAt === null) {
			for (const ancestorId of whiteboard.ancestorIds ?? []) {
				const ancestor = await ctx.db.get(ancestorId);
				if (ancestor && ancestor.archivedAt === null) {
					breadcrumbs.push(ancestor);
				}
			}
			breadcrumbs.push(whiteboard);
		}

		// Resolve `auto` card references to their targets' current titles so a
		// renamed card shows its latest name on a fresh read.
		const referenceIds = collectCardReferenceIds(card.content);
		const content =
			referenceIds.length > 0
				? resolveCardReferenceTitles(
						card.content,
						await fetchCardTitles(ctx, referenceIds),
					)
				: card.content;

		// The card's placement on a board, so callers (e.g. the preview dialog)
		// can offer "focus on board" / "go to board".
		const boardItem = await ctx.db
			.query("boardItems")
			.withIndex("by_card", (q) => q.eq("cardId", card._id))
			.filter((q) => q.eq(q.field("archivedAt"), null))
			.first();

		return {
			card: { ...card, content },
			whiteboard,
			breadcrumbs,
			boardWhiteboardId: boardItem?.whiteboardId ?? card.whiteboardId,
			shapeId: boardItem?.shapeId ?? null,
		};
	},
});

export const updateContent = mutation({
	args: {
		cardId: v.id("cards"),
		content: v.any(),
		expectedVersion: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) {
			throw new Error("Card not found");
		}

		if (
			args.expectedVersion !== undefined &&
			args.expectedVersion !== card.version
		) {
			throw new Error("Card was updated elsewhere");
		}

		const reconciledContent = await reconcileCardFileRefs(
			ctx,
			card._id,
			args.content,
		);
		// Normalize card-reference link marks: canonical href, auto/custom label
		// tracking, and refreshed resolved titles.
		const referenceIds = collectCardReferenceIds(reconciledContent);
		const nextContent =
			referenceIds.length > 0
				? normalizeCardReferences(
						reconciledContent,
						await fetchCardTitles(ctx, referenceIds),
					)
				: reconciledContent;
		const serializedContent = JSON.stringify(nextContent);
		if (serializedContent.length > MAX_CARD_CONTENT_BYTES) {
			throw new Error("Card content is too large");
		}

		const now = Date.now();
		const metadata = deriveCardMetadata(nextContent);
		await ctx.db.patch(card._id, {
			content: nextContent,
			derivedTitle: metadata.derivedTitle,
			plainText: metadata.plainText,
			preview: metadata.preview,
			version: card.version + 1,
			updatedAt: now,
		});
		if (card.whiteboardId) {
			await ctx.db.patch(card.whiteboardId, {
				updatedAt: now,
			});
		}

		return card.version + 1;
	},
});

export const listByWhiteboard = query({
	args: {
		whiteboardId: v.id("whiteboards"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("cards")
			.withIndex("by_whiteboard_archived_updated", (q) =>
				q.eq("whiteboardId", args.whiteboardId).eq("archivedAt", null),
			)
			.order("desc")
			.paginate(args.paginationOpts);
	},
});

export const listOrphans = query({
	args: {
		paginationOpts: paginationOptsValidator,
		searchTerm: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const activeCards = await ctx.db
			.query("cards")
			.filter((q) => q.eq(q.field("archivedAt"), null))
			.collect();

		const activeCardsFiltered =
			args.searchTerm?.trim()
				? activeCards.filter((card) => {
						const term = args.searchTerm!.toLowerCase();
						return (
							card.plainText.toLowerCase().includes(term) ||
							card.derivedTitle.toLowerCase().includes(term)
						);
					})
				: activeCards;

		const whiteboardIds = Array.from(
			new Set(
				activeCardsFiltered.flatMap((card) =>
					card.whiteboardId === null ? [] : [card.whiteboardId],
				),
			)
		);
		const whiteboards = await Promise.all(
			whiteboardIds.map((whiteboardId) => ctx.db.get(whiteboardId)),
		);
		const activeWhiteboardIds = new Set(
			whiteboards.flatMap((whiteboard, index) =>
				isActiveWhiteboard(whiteboard) ? [whiteboardIds[index]] : [],
			),
		);
		const orphans = activeCardsFiltered
			.filter(
				(card) =>
					card.whiteboardId === null ||
					!activeWhiteboardIds.has(card.whiteboardId),
			)
			.sort((a, b) => b.updatedAt - a.updatedAt);
		const start = parseOffsetCursor(args.paginationOpts.cursor);
		const end = Math.min(start + args.paginationOpts.numItems, orphans.length);

		return {
			isDone: end >= orphans.length,
			page: orphans.slice(start, end),
			continueCursor: String(end),
		};
	},
});

export const archiveCard = mutation({
	args: { cardId: v.id("cards") },
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) return;

		const now = Date.now();

		if (card.whiteboardId) {
			const boardItem = await ctx.db
				.query("boardItems")
				.withIndex("by_card", (q) => q.eq("cardId", card._id))
				.filter((q) => q.eq(q.field("archivedAt"), null))
				.first();

			if (boardItem) {
				await ctx.db.patch(boardItem._id, {
					archivedAt: now,
					updatedAt: now,
				});
			}

			const whiteboard = await ctx.db.get(card.whiteboardId);
			if (whiteboard && whiteboard.archivedAt === null) {
				await ctx.db.patch(whiteboard._id, {
					cardCount: Math.max(0, (whiteboard.cardCount ?? 0) - 1),
					updatedAt: now,
				});
			}
		}

		await clearCardFileRefs(ctx, card._id);
		await ctx.db.patch(card._id, {
			archivedAt: now,
			updatedAt: now,
		});
	},
});

export const appendToWhiteboard = mutation({
	args: {
		cardId: v.id("cards"),
		whiteboardId: v.id("whiteboards"),
	},
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) {
			throw new Error("Card not found");
		}
		if (card.whiteboardId !== null) {
			throw new Error("Card is already on a whiteboard");
		}

		const whiteboard = await ctx.db.get(args.whiteboardId);
		if (!whiteboard || whiteboard.archivedAt !== null) {
			throw new Error("Whiteboard not found");
		}

		const now = Date.now();
		const shapeId = `card-${card._id}`;
		const existingItem = await ctx.db
			.query("boardItems")
			.withIndex("by_whiteboard_shape", (q) =>
				q.eq("whiteboardId", whiteboard._id).eq("shapeId", shapeId),
			)
			.first();

		if (!existingItem || existingItem.archivedAt !== null) {
			await ctx.db.insert("boardItems", {
				whiteboardId: whiteboard._id,
				kind: "card",
				cardId: card._id,
				childWhiteboardId: null,
				shapeId,
				x: 0,
				y: (whiteboard.cardCount ?? 0) * 40,
				w: 576,
				h: 160,
				rotation: 0,
				zIndex: now,
				archivedAt: null,
				updatedAt: now,
			});
		}

		if (existingItem && existingItem.archivedAt !== null) {
			await ctx.db.patch(existingItem._id, {
				archivedAt: null,
				updatedAt: now,
			});
		}

		await ctx.db.patch(card._id, {
			whiteboardId: whiteboard._id,
			updatedAt: now,
		});

		await ctx.db.patch(whiteboard._id, {
			cardCount: (whiteboard.cardCount ?? 0) + 1,
			updatedAt: now,
		});
	},
});

function isActiveWhiteboard(
	whiteboard: Doc<"whiteboards"> | null,
): whiteboard is Doc<"whiteboards"> {
	return !!whiteboard && whiteboard.archivedAt === null;
}

function parseOffsetCursor(cursor: string | null) {
	if (cursor === null) {
		return 0;
	}

	const offset = Number.parseInt(cursor, 10);
	return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}
