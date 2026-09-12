import { type MutableRefObject, useEffect } from "react";
import type { Editor } from "tldraw";
import type { SequencedFrame, WhiteboardFrame } from "../frame-sync";
import {
	enterHydration,
	releaseHydrationAfterStoreFlush,
} from "../hydration-gate";
import type { Id } from "../ids";
import { registerSubwhiteboardDropHandler } from "../SubwhiteboardLinkShape";
import {
	type BoardItemResult,
	getManagedShapeFrame,
	isManagedWhiteboardShape,
} from "../whiteboard-canvas-helpers";

export function useSubwhiteboardDrop({
	editor,
	moveItem,
	queueFrameUpdate,
	hydratingRef,
	itemIdByShapeIdRef,
	latestItemsRef,
	optimisticFramesRef,
	queuedFrameUpdatesRef,
}: {
	editor: Editor | null;
	moveItem: (input: {
		itemId: string;
		targetWhiteboardId: string;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
		zIndex: number;
	}) => Promise<unknown>;
	queueFrameUpdate: (itemId: Id<"boardItems">, frame: WhiteboardFrame) => void;
	hydratingRef: MutableRefObject<boolean>;
	itemIdByShapeIdRef: MutableRefObject<Map<string, Id<"boardItems">>>;
	latestItemsRef: MutableRefObject<Map<Id<"boardItems">, BoardItemResult>>;
	optimisticFramesRef: MutableRefObject<Map<Id<"boardItems">, SequencedFrame>>;
	queuedFrameUpdatesRef: MutableRefObject<
		Map<Id<"boardItems">, SequencedFrame>
	>;
}) {
	useEffect(() => {
		if (!editor) return;

		return registerSubwhiteboardDropHandler(editor, (target, shapes) => {
			const targetWhiteboardId = target.props.childWhiteboardId;
			if (!targetWhiteboardId) return;

			const zIndexByShapeId = new Map(
				editor
					.getCurrentPageShapesSorted()
					.map((shape, index) => [shape.id, index]),
			);
			const droppedItems = shapes.flatMap((shape) => {
				if (!isManagedWhiteboardShape(shape)) return [];
				const itemId = itemIdByShapeIdRef.current.get(shape.id);
				if (!itemId) return [];
				return [
					{
						shape,
						itemId,
						frame: {
							...getManagedShapeFrame(shape),
							zIndex: zIndexByShapeId.get(shape.id) ?? 0,
						},
					},
				];
			});
			for (const { itemId } of droppedItems) {
				queuedFrameUpdatesRef.current.delete(itemId);
			}

			void (async () => {
				for (const { shape, itemId, frame } of droppedItems) {
					try {
						await moveItem({
							itemId,
							targetWhiteboardId,
							x: frame.x,
							y: frame.y,
							w: frame.w,
							h: frame.h,
							rotation: frame.rotation,
							zIndex: frame.zIndex,
						});
						itemIdByShapeIdRef.current.delete(shape.id);
						latestItemsRef.current.delete(itemId);
						optimisticFramesRef.current.delete(itemId);
						const release = enterHydration(hydratingRef);
						editor.deleteShapes([shape.id]);
						releaseHydrationAfterStoreFlush(release);
					} catch (error) {
						queueFrameUpdate(itemId, frame);
						console.warn("Failed to move item into sub-whiteboard", error);
					}
				}
			})();
		});
	}, [
		editor,
		hydratingRef,
		itemIdByShapeIdRef,
		latestItemsRef,
		moveItem,
		optimisticFramesRef,
		queueFrameUpdate,
		queuedFrameUpdatesRef,
	]);
}
