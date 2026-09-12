import type { EntityRow } from "../../repository/entities";
import type { EntityWrite } from "../../workspace";
import { deriveChildHierarchy } from "../derive/hierarchy";
import type { Plan } from "../planner";
import { upsertWrite } from "../planner";

type ParentWhiteboard = EntityRow & {
	ancestorIds: string[];
	depth: number;
	pathKey: string;
};

export function planCreateSubwhiteboard(
	snapshot: {
		parent: ParentWhiteboard | null;
		activeChildCount: number;
	},
	input: {
		boardId: string;
		itemId: string;
		shapeId: string;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
	},
	context: { now: number; deviceId: string },
): Plan<{ itemId: string; childWhiteboardId: string }> {
	const metadata = {
		createdAt: context.now,
		updatedAt: context.now,
		updatedByDeviceId: context.deviceId,
		deletedAt: null,
	};
	const hierarchy = deriveChildHierarchy(
		snapshot.parent,
		snapshot.activeChildCount,
		context.now,
	);
	const board = {
		id: input.boardId,
		...metadata,
		title: "Untitled whiteboard",
		...hierarchy,
		archivedAt: null,
	};
	const item = {
		id: input.itemId,
		...metadata,
		whiteboardId: snapshot.parent?.id ?? null,
		kind: "subwhiteboard",
		cardId: null,
		childWhiteboardId: input.boardId,
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
		{
			entity: "whiteboard",
			operation: "upsert",
			id: board.id,
			value: board,
		},
		{
			entity: "boardItem",
			operation: "upsert",
			id: item.id,
			value: item,
		},
	];
	if (snapshot.parent) {
		// Serializes child creation with reparenting and sibling creation. A
		// conflict retries with fresh ancestry and a fresh sibling sort key.
		writes.push(
			upsertWrite("whiteboard", snapshot.parent, snapshot.parent.revision),
		);
	}
	return {
		writes,
		result: { itemId: item.id, childWhiteboardId: board.id },
	};
}
