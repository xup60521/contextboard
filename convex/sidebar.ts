import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";

export const get = query({
	args: {
		whiteboardIds: v.array(v.id("whiteboards")),
		cardIds: v.array(v.id("cards")),
	},
	handler: async (ctx, args): Promise<{
		whiteboards: Array<{ _id: Id<"whiteboards">; title: string }>;
		cards: Array<{ _id: Id<"cards">; title: string }>;
	}> => {
		const uniqueWhiteboardIds = [...new Set(args.whiteboardIds)];
		const uniqueCardIds = [...new Set(args.cardIds)];

		if (uniqueWhiteboardIds.length > 100) {
			throw new Error("Cannot load more than 100 whiteboards at once");
		}

		if (uniqueCardIds.length > 100) {
			throw new Error("Cannot load more than 100 cards at once");
		}

		const whiteboardsById = new Map<
			Id<"whiteboards">,
			{ _id: Id<"whiteboards">; title: string }
		>();
		for (const whiteboardId of uniqueWhiteboardIds) {
			const whiteboard = await ctx.db.get(whiteboardId);
			if (!whiteboard || whiteboard.archivedAt !== null) {
				continue;
			}

			whiteboardsById.set(whiteboard._id, {
				_id: whiteboard._id,
				title: whiteboard.title,
			});
		}

		const cardsById = new Map<Id<"cards">, { _id: Id<"cards">; title: string }>();
		for (const cardId of uniqueCardIds) {
			const card = await ctx.db.get(cardId);
			if (!card || card.archivedAt !== null) {
				continue;
			}

			cardsById.set(card._id, {
				_id: card._id,
				title: card.derivedTitle || "Untitled card",
			});
		}

		return {
			whiteboards: [...whiteboardsById.values()].sort((left, right) =>
				left.title.localeCompare(right.title),
			),
			cards: [...cardsById.values()],
		};
	},
});
