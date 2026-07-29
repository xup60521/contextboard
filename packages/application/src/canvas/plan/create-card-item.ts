import { deriveCardMetadata } from "../../cards";
import type { EntityWrite } from "../../workspace";
import type { Plan } from "../planner";

export function planCreateCardItem(
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
): Plan<{ itemId: string; cardId: string }> {
	const metadata = {
		createdAt: context.now,
		updatedAt: context.now,
		updatedByDeviceId: context.deviceId,
		deletedAt: null,
	};
	const card = {
		id: input.cardId,
		...metadata,
		...deriveCardMetadata(input.content),
		content: input.content,
		contentVersion: 1,
		activePlacementCount: 1,
		archivedAt: null,
	};
	const item = {
		id: input.itemId,
		...metadata,
		whiteboardId: input.whiteboardId,
		kind: "card",
		cardId: input.cardId,
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
	const writes: EntityWrite[] = [
		{ entity: "card", operation: "upsert", id: card.id, value: card },
		{ entity: "boardItem", operation: "upsert", id: item.id, value: item },
	];
	return {
		writes,
		result: { itemId: input.itemId, cardId: input.cardId },
	};
}
