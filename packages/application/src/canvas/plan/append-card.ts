import type { EntityWrite } from "../../workspace";
import { type Plan, upsertWrite } from "../planner";

type Card = Record<string, unknown> & {
	id: string;
	revision: number;
	activePlacementCount: number;
};

type Placement = Record<string, unknown> & {
	id: string;
	revision: number;
	cardId: string | null;
	whiteboardId: string | null;
	shapeId: string;
};

export type AppendCardResult = {
	cardId: string;
	itemId: string;
	shapeId: string;
	whiteboardId: string;
	created: boolean;
};

export function planAppendCard(
	snapshot: { card: Card | null; existingPlacement: Placement | null },
	input: {
		whiteboardId: string;
		itemId: string;
		shapeId: string;
		x: number;
		y: number;
		w: number;
		h: number;
		heightMeasurementPending?: boolean;
		rotation: number;
		zIndex: number;
	},
	context: { now: number; deviceId: string },
): Plan<AppendCardResult | null> {
	if (snapshot.existingPlacement) {
		return {
			writes: [],
			result: {
				cardId: snapshot.existingPlacement.cardId ?? "",
				itemId: snapshot.existingPlacement.id,
				shapeId: snapshot.existingPlacement.shapeId,
				whiteboardId: input.whiteboardId,
				created: false,
			},
		};
	}
	if (!snapshot.card) return { writes: [], result: null };

	const item = {
		id: input.itemId,
		createdAt: context.now,
		updatedAt: context.now,
		updatedByDeviceId: context.deviceId,
		deletedAt: null,
		whiteboardId: input.whiteboardId,
		kind: "card",
		cardId: snapshot.card.id,
		childWhiteboardId: null,
		shapeId: input.shapeId,
		x: input.x,
		y: input.y,
		w: input.w,
		h: input.h,
		heightMeasurementPending: input.heightMeasurementPending === true,
		rotation: input.rotation,
		zIndex: input.zIndex,
		archivedAt: null,
	};
	const writes: EntityWrite[] = [
		{
			entity: "boardItem",
			operation: "upsert",
			id: item.id,
			value: item,
		},
		upsertWrite(
			"card",
			{
				...snapshot.card,
				activePlacementCount: snapshot.card.activePlacementCount + 1,
			},
			snapshot.card.revision,
		),
	];
	return {
		writes,
		result: {
			cardId: snapshot.card.id,
			itemId: item.id,
			shapeId: item.shapeId,
			whiteboardId: input.whiteboardId,
			created: true,
		},
	};
}
