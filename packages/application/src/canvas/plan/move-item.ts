import { type EntityRow, isActiveRow } from "../../repository/entities";
import { deriveChildHierarchy } from "../derive/hierarchy";
import type { Plan } from "../planner";
import { upsertWrite } from "../planner";

export type MoveItemFrame = {
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	rotation?: number;
	zIndex?: number;
};

function stringField(row: EntityRow, field: string) {
	const value = row[field];
	return typeof value === "string" ? value : null;
}

function hierarchyOf(row: EntityRow) {
	return {
		id: row.id,
		ancestorIds: Array.isArray(row.ancestorIds)
			? row.ancestorIds.map(String)
			: [],
		depth: typeof row.depth === "number" ? row.depth : 0,
		pathKey: String(row.pathKey ?? ""),
	};
}

export function planMoveItem(
	snapshot: {
		item: EntityRow;
		whiteboards: EntityRow[];
	},
	input: MoveItemFrame & { targetWhiteboardId: string | null },
	context: { now: number; deviceId: string },
): Plan<null> {
	const item = snapshot.item;
	if (!isActiveRow(item)) throw new Error(`Item not found: ${item.id}`);

	const activeBoards = snapshot.whiteboards.filter(isActiveRow);
	const boardById = new Map(activeBoards.map((board) => [board.id, board]));
	const target = input.targetWhiteboardId
		? boardById.get(input.targetWhiteboardId)
		: null;
	if (input.targetWhiteboardId && !target) {
		throw new Error(`Whiteboard not found: ${input.targetWhiteboardId}`);
	}
	if (item.kind === "card" && !target) {
		throw new Error("Cards cannot be moved to the root whiteboard");
	}

	const currentWhiteboardId = stringField(item, "whiteboardId");
	const movedItem = {
		...item,
		whiteboardId: input.targetWhiteboardId,
		x: input.x ?? item.x,
		y: input.y ?? item.y,
		w: input.w ?? item.w,
		h: input.h ?? item.h,
		rotation: input.rotation ?? item.rotation,
		zIndex: input.zIndex ?? item.zIndex,
		updatedAt: context.now,
		updatedByDeviceId: context.deviceId,
	};
	const writes = [upsertWrite("boardItem", movedItem, item.revision)];

	if (
		item.kind !== "subwhiteboard" ||
		currentWhiteboardId === input.targetWhiteboardId
	) {
		return { writes, result: null };
	}

	const childWhiteboardId = stringField(item, "childWhiteboardId");
	const movedBoard = childWhiteboardId
		? boardById.get(childWhiteboardId)
		: null;
	if (!movedBoard) throw new Error("Sub-whiteboard not found");

	const subtreeIds = new Set([movedBoard.id]);
	let foundDescendant = true;
	while (foundDescendant) {
		foundDescendant = false;
		for (const board of activeBoards) {
			const parentId = stringField(board, "parentWhiteboardId");
			if (parentId && subtreeIds.has(parentId) && !subtreeIds.has(board.id)) {
				subtreeIds.add(board.id);
				foundDescendant = true;
			}
		}
	}
	if (input.targetWhiteboardId && subtreeIds.has(input.targetWhiteboardId)) {
		throw new Error(
			"A sub-whiteboard cannot be moved into itself or a descendant",
		);
	}
	if (target) {
		// Touching the target with its expected revision makes hierarchy validation
		// atomic with the move. A concurrent move that changes either hierarchy
		// conflicts, retries from a fresh snapshot, and cannot create a cycle.
		writes.push(upsertWrite("whiteboard", target, target.revision));
	}

	const siblingCount = activeBoards.filter(
		(board) =>
			stringField(board, "parentWhiteboardId") === input.targetWhiteboardId &&
			board.id !== movedBoard.id,
	).length;
	const movedHierarchy = deriveChildHierarchy(
		target ? hierarchyOf(target) : null,
		siblingCount,
		context.now,
	);
	const updatedById = new Map<string, EntityRow>();
	const updatedRoot = {
		...movedBoard,
		...movedHierarchy,
		updatedAt: context.now,
		updatedByDeviceId: context.deviceId,
	};
	updatedById.set(updatedRoot.id, updatedRoot);
	writes.push(upsertWrite("whiteboard", updatedRoot, movedBoard.revision));

	let remaining = subtreeIds.size - 1;
	while (remaining > 0) {
		let progressed = false;
		for (const board of activeBoards) {
			if (board.id === movedBoard.id || updatedById.has(board.id)) continue;
			const parentId = stringField(board, "parentWhiteboardId");
			if (!parentId || !subtreeIds.has(board.id)) continue;
			const updatedParent = updatedById.get(parentId);
			if (!updatedParent) continue;

			const parentHierarchy = hierarchyOf(updatedParent);
			const sortKey = String(board.sortKey ?? "");
			const updated = {
				...board,
				ancestorIds: [...parentHierarchy.ancestorIds, parentHierarchy.id],
				depth: parentHierarchy.depth + 1,
				pathKey: `${parentHierarchy.pathKey}/${sortKey}`,
				updatedAt: context.now,
				updatedByDeviceId: context.deviceId,
			};
			updatedById.set(updated.id, updated);
			writes.push(upsertWrite("whiteboard", updated, board.revision));
			remaining -= 1;
			progressed = true;
		}
		if (!progressed) throw new Error("Whiteboard hierarchy is invalid");
	}

	return { writes, result: null };
}
