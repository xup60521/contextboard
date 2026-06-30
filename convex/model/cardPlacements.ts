import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

export type ActiveCardPlacement = Pick<
	Doc<"boardItems">,
	"_id" | "whiteboardId" | "shapeId" | "updatedAt" | "cardId"
>;

export async function listActivePlacements(
	ctx: DbCtx,
	cardId: Id<"cards">,
): Promise<ActiveCardPlacement[]> {
	const placements = await ctx.db
		.query("boardItems")
		.withIndex("by_card", (q) => q.eq("cardId", cardId))
		.filter((q) => q.eq(q.field("archivedAt"), null))
		.collect();

	return placements
		.filter(
			(item): item is typeof item & { whiteboardId: Id<"whiteboards"> | null } =>
				item.kind === "card" && item.cardId === cardId,
		)
		.map((item) => ({
			_id: item._id,
			cardId: item.cardId,
			whiteboardId: item.whiteboardId,
			shapeId: item.shapeId,
			updatedAt: item.updatedAt,
		}))
		.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function countActiveCardPlacements(
	ctx: DbCtx,
	cardId: Id<"cards">,
): Promise<number> {
	const card = await ctx.db.get(cardId);
	if (!card) return 0;
	return card.activePlacementCount ?? (await listActivePlacements(ctx, cardId)).length;
}

export async function incrementActivePlacementCount(
	ctx: MutationCtx,
	cardId: Id<"cards">,
): Promise<number> {
	const card = await ctx.db.get(cardId);
	if (!card) {
		throw new Error("Card not found");
	}

	const nextCount = (card.activePlacementCount ?? 0) + 1;
	await ctx.db.patch(card._id, {
		activePlacementCount: nextCount,
	});
	return nextCount;
}

export async function decrementActivePlacementCount(
	ctx: MutationCtx,
	cardId: Id<"cards">,
): Promise<number> {
	const card = await ctx.db.get(cardId);
	if (!card) {
		throw new Error("Card not found");
	}

	const currentCount = card.activePlacementCount ?? 0;
	if (currentCount <= 0) {
		throw new Error(`Card ${cardId} activePlacementCount underflow`);
	}

	const nextCount = currentCount - 1;
	await ctx.db.patch(card._id, {
		activePlacementCount: nextCount,
	});
	return nextCount;
}

export async function setActivePlacementCount(
	ctx: MutationCtx,
	cardId: Id<"cards">,
	count: number,
): Promise<void> {
	if (count < 0) {
		throw new Error(`Card ${cardId} activePlacementCount cannot be negative`);
	}

	const card = await ctx.db.get(cardId);
	if (!card) {
		throw new Error("Card not found");
	}

	await ctx.db.patch(card._id, {
		activePlacementCount: count,
	});
}

export async function hasActivePlacementOnBoard(
	ctx: DbCtx,
	cardId: Id<"cards">,
	whiteboardId: Id<"whiteboards">,
): Promise<boolean> {
	const placements = await listActivePlacements(ctx, cardId);
	return placements.some((placement) => placement.whiteboardId === whiteboardId);
}

export async function getActivePlacementOnBoard(
	ctx: DbCtx,
	cardId: Id<"cards">,
	whiteboardId: Id<"whiteboards">,
): Promise<ActiveCardPlacement | null> {
	const placements = await listActivePlacements(ctx, cardId);
	return placements.find((placement) => placement.whiteboardId === whiteboardId) ?? null;
}

export async function getPreferredPlacement(
	ctx: DbCtx,
	cardId: Id<"cards">,
	currentWhiteboardId?: Id<"whiteboards"> | null,
): Promise<ActiveCardPlacement | null> {
	const placements = await listActivePlacements(ctx, cardId);
	return selectPreferredPlacement(placements, currentWhiteboardId);
}

export function selectPreferredPlacement(
	placements: ActiveCardPlacement[],
	currentWhiteboardId?: Id<"whiteboards"> | null,
): ActiveCardPlacement | null {
	if (placements.length === 0) return null;

	const sorted = [...placements].sort((left, right) => {
		const leftIsCurrent =
			currentWhiteboardId !== undefined &&
			left.whiteboardId === currentWhiteboardId;
		const rightIsCurrent =
			currentWhiteboardId !== undefined &&
			right.whiteboardId === currentWhiteboardId;
		if (leftIsCurrent !== rightIsCurrent) {
			return leftIsCurrent ? -1 : 1;
		}

		return right.updatedAt - left.updatedAt;
	});

	return sorted[0] ?? null;
}
