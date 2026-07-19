import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import type { Editor } from "tldraw";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type SequencedFrame,
	shouldClearOptimisticFrame,
	type WhiteboardFrame,
} from "../frame-sync";
import { rehydrateItemShape, type BoardItemResult } from "../whiteboard-canvas-helpers";

export function useFrameSync({
	editor,
	updateItemFrame,
	latestItemsRef,
	optimisticFramesRef,
	hydratingRef,
}: {
	editor: Editor | null;
	updateItemFrame: (args: {
		itemId: Id<"boardItems">;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
		zIndex: number;
	}) => Promise<unknown>;
	latestItemsRef: RefObject<Map<Id<"boardItems">, BoardItemResult>>;
	optimisticFramesRef: MutableRefObject<Map<Id<"boardItems">, SequencedFrame>>;
	hydratingRef: MutableRefObject<boolean>;
}) {
	const queuedFrameUpdatesRef = useRef(
		new Map<Id<"boardItems">, SequencedFrame>(),
	);
	const frameUpdateSeqRef = useRef(0);
	const flushTimerRef = useRef<number | null>(null);

	const flushFrameUpdates = useCallback(() => {
		flushTimerRef.current = null;
		const queuedFrames = queuedFrameUpdatesRef.current;
		queuedFrameUpdatesRef.current = new Map();

		for (const [itemId, sequencedFrame] of queuedFrames) {
			void updateItemFrame({ itemId, ...sequencedFrame.frame }).catch(() => {
				const currentFrame = optimisticFramesRef.current.get(itemId);
				if (!shouldClearOptimisticFrame(currentFrame, sequencedFrame.seq)) {
					return;
				}

				optimisticFramesRef.current.delete(itemId);
				const latestItem = latestItemsRef.current?.get(itemId);
				if (!latestItem || !editor) return;

				hydratingRef.current = true;
				editor.run(() => rehydrateItemShape(editor, latestItem), {
					history: "ignore",
				});
				window.setTimeout(() => {
					hydratingRef.current = false;
				}, 0);
			});
		}
	}, [editor, hydratingRef, latestItemsRef, optimisticFramesRef, updateItemFrame]);

	const queueFrameUpdate = useCallback(
		(itemId: Id<"boardItems">, frame: WhiteboardFrame) => {
			const sequencedFrame = {
				seq: frameUpdateSeqRef.current + 1,
				frame,
			};
			frameUpdateSeqRef.current = sequencedFrame.seq;
			queuedFrameUpdatesRef.current.set(itemId, sequencedFrame);
			optimisticFramesRef.current.set(itemId, sequencedFrame);

			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
			}

			flushTimerRef.current = window.setTimeout(flushFrameUpdates, 250);
		},
		[flushFrameUpdates, optimisticFramesRef],
	);

	return {
		flushFrameUpdates,
		queueFrameUpdate,
		queuedFrameUpdatesRef,
		flushTimerRef,
	};
}
