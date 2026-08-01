import type { EntityWrite } from "../../workspace";
import { type Plan, tombstoneWrite, upsertWrite } from "../planner";

type Placement = Record<string, unknown> & {
	id: string;
	revision: number;
	cardId: string | null;
	whiteboardId?: string | null;
	archivedAt: number | null;
};

type Card = Record<string, unknown> & {
	id: string;
	revision: number;
	activePlacementCount: number;
	archivedAt: number | null;
};

export function planArchiveItem(
	snapshot: {
		item: Placement;
		card: Card | null;
		relations?: Array<{
			id: string;
			revision: number;
			whiteboardId: unknown;
			sourceCardId: unknown;
			targetCardId: unknown;
			arrowShapeId?: unknown;
		}>;
	},
	input: { deleteCards?: boolean },
	context: { now: number },
): Plan<null> {
	const writes: EntityWrite[] = [
		upsertWrite(
			"boardItem",
			{ ...snapshot.item, archivedAt: context.now },
			snapshot.item.revision,
		),
	];
	if (snapshot.item.cardId && snapshot.item.whiteboardId) {
		writes.push(
			...(snapshot.relations ?? [])
				.filter(
					(relation) =>
						typeof relation.arrowShapeId === "string" &&
						relation.whiteboardId === snapshot.item.whiteboardId &&
						(relation.sourceCardId === snapshot.item.cardId ||
							relation.targetCardId === snapshot.item.cardId),
				)
				.map((relation) => tombstoneWrite("cardRelation", relation)),
		);
	}
	if (snapshot.card) {
		const activePlacementCount = Math.max(
			0,
			snapshot.card.activePlacementCount - 1,
		);
		writes.push(
			upsertWrite(
				"card",
				{
					...snapshot.card,
					activePlacementCount,
					archivedAt:
						input.deleteCards && activePlacementCount === 0
							? context.now
							: snapshot.card.archivedAt,
				},
				snapshot.card.revision,
			),
		);
	}
	return { writes, result: null };
}
