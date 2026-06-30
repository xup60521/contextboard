import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";

export const get = query({
	args: {
		activeCardId: v.union(v.id("cards"), v.null()),
	},
	handler: async (ctx, args): Promise<{
		whiteboards: Array<{ _id: Id<"whiteboards">; title: string }>;
		activeCardTitle: string | null;
	}> => {
		const whiteboards = await ctx.db
			.query("whiteboards")
			.filter((q) => q.eq(q.field("archivedAt"), null))
			.collect();

		const activeCardTitle = await resolveActiveCardTitle(ctx, args.activeCardId);

		return {
			whiteboards: whiteboards
				.map((whiteboard) => ({
					_id: whiteboard._id,
					title: whiteboard.title,
				}))
				.sort((left, right) => left.title.localeCompare(right.title)),
			activeCardTitle,
		};
	},
});

async function resolveActiveCardTitle(
	ctx: QueryCtx,
	activeCardId: Id<"cards"> | null,
) {
	if (activeCardId === null) {
		return null;
	}

	const card = await ctx.db.get(activeCardId);
	if (!card || card.archivedAt !== null) {
		return null;
	}

	return card.derivedTitle || "Untitled card";
}
