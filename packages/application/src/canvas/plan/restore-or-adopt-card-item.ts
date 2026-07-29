import type { EntityWrite } from "../../workspace";
import { type Plan, upsertWrite } from "../planner";
import { planCreateCardItem } from "./create-card-item";

type Card = Record<string, unknown> & {
	id: string;
	revision: number;
	activePlacementCount: number;
	archivedAt: number | null;
	deletedAt: number | null;
};

type Placement = Record<string, unknown> & {
	id: string;
	revision: number;
	kind: "card" | "subwhiteboard";
	cardId: string | null;
	archivedAt: number | null;
	deletedAt: number | null;
};

export type RestoreOrAdoptResult = {
	itemId: string | null;
	adoptedCardId: string | null;
};

const active = (row: { archivedAt: number | null; deletedAt: number | null }) =>
	row.archivedAt === null && row.deletedAt === null;

export function planRestoreOrAdoptCardItem(
	snapshot: {
		existingPlacement: Placement | null;
		existingCard: Card | null;
		sourceCard: Card | null;
	},
	input: {
		whiteboardId: string;
		cardId: string;
		itemId: string;
		shapeId: string;
		content: unknown;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
	},
	context: { now: number; deviceId: string },
): Plan<RestoreOrAdoptResult> {
	const existing = snapshot.existingPlacement;
	if (existing) {
		if (active(existing))
			return {
				writes: [],
				result: { itemId: existing.id, adoptedCardId: null },
			};
		if (existing.kind !== "card" || !existing.cardId)
			return { writes: [], result: { itemId: null, adoptedCardId: null } };
		if (!snapshot.existingCard) throw new Error("Card not found");
		const writes: EntityWrite[] = [
			upsertWrite(
				"boardItem",
				{ ...existing, archivedAt: null },
				existing.revision,
			),
			upsertWrite(
				"card",
				{
					...snapshot.existingCard,
					archivedAt: null,
					activePlacementCount:
						snapshot.existingCard.activePlacementCount + 1,
				},
				snapshot.existingCard.revision,
			),
		];
		return {
			writes,
			result: { itemId: existing.id, adoptedCardId: null },
		};
	}

	if (snapshot.sourceCard && active(snapshot.sourceCard)) {
		const item = {
			id: input.itemId,
			createdAt: context.now,
			updatedAt: context.now,
			updatedByDeviceId: context.deviceId,
			deletedAt: null,
			whiteboardId: input.whiteboardId,
			kind: "card",
			cardId: snapshot.sourceCard.id,
			childWhiteboardId: null,
			shapeId: input.shapeId,
			x: input.x,
			y: input.y,
			w: input.w,
			h: input.h,
			rotation: input.rotation,
			zIndex: context.now,
			archivedAt: null,
		};
		return {
			writes: [
				{
					entity: "boardItem",
					operation: "upsert",
					id: item.id,
					value: item,
				},
				upsertWrite(
					"card",
					{
						...snapshot.sourceCard,
						activePlacementCount:
							snapshot.sourceCard.activePlacementCount + 1,
					},
					snapshot.sourceCard.revision,
				),
			],
			result: { itemId: item.id, adoptedCardId: null },
		};
	}

	const adopted = planCreateCardItem(input, context);
	return {
		writes: adopted.writes,
		result: { itemId: adopted.result.itemId, adoptedCardId: input.cardId },
	};
}
