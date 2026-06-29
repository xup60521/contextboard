import { useCallback, type MutableRefObject } from "react";
import { createShapeId, type TLShapeId, type VecLike } from "tldraw";
import type { Id } from "../../../../convex/_generated/dataModel";

export function useItemCreation({
	whiteboardId,
	createCardItem,
	createSubwhiteboardItem,
	pendingEditShapeIdRef,
}: {
	whiteboardId: Id<"whiteboards"> | null;
	createCardItem: (args: {
		whiteboardId: Id<"whiteboards">;
		shapeId: TLShapeId;
		x: number;
		y: number;
	}) => Promise<unknown>;
	createSubwhiteboardItem: (args: {
		parentWhiteboardId: Id<"whiteboards"> | null;
		shapeId: TLShapeId;
		x: number;
		y: number;
	}) => Promise<unknown>;
	pendingEditShapeIdRef: MutableRefObject<TLShapeId | null>;
}) {
	const createCardAt = useCallback(
		(point: VecLike) => {
			if (!whiteboardId) return;

			const shapeId = createShapeId();
			pendingEditShapeIdRef.current = shapeId;

			void createCardItem({
				whiteboardId,
				shapeId,
				x: point.x,
				y: point.y,
			}).catch(() => {
				if (pendingEditShapeIdRef.current === shapeId) {
					pendingEditShapeIdRef.current = null;
				}
			});
		},
		[createCardItem, pendingEditShapeIdRef, whiteboardId],
	);

	const createSubwhiteboardAt = useCallback(
		(point: VecLike) => {
			const shapeId = createShapeId();
			pendingEditShapeIdRef.current = shapeId;

			void createSubwhiteboardItem({
				parentWhiteboardId: whiteboardId,
				shapeId,
				x: point.x,
				y: point.y,
			}).catch(() => {
				if (pendingEditShapeIdRef.current === shapeId) {
					pendingEditShapeIdRef.current = null;
				}
			});
		},
		[createSubwhiteboardItem, pendingEditShapeIdRef, whiteboardId],
	);

	return { createCardAt, createSubwhiteboardAt };
}
