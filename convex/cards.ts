import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { reconcileCardFileRefs } from "./fileLifecycle";
import { deriveCardMetadata } from "./model/cardMetadata";

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

		return { card, whiteboard, breadcrumbs };
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

		const nextContent = await reconcileCardFileRefs(ctx, card._id, args.content);
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
