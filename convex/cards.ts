import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { reconcileCardFileRefs } from "./fileLifecycle";
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
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("cards")
			.withIndex("by_whiteboard_archived_updated", (q) =>
				q.eq("whiteboardId", null).eq("archivedAt", null),
			)
			.order("desc")
			.paginate(args.paginationOpts);
	},
});
