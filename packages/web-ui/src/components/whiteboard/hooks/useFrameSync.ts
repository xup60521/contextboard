import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import type { Editor } from "tldraw";
import type { Id } from "../ids";
import {
	type SequencedFrame,
	shouldClearOptimisticFrame,
	type WhiteboardFrame,
} from "../frame-sync";
import { rehydrateItemShape, type BoardItemResult } from "../whiteboard-canvas-helpers";

export function useFrameSync({
	editor,
	updateItemFrames,
	latestItemsRef,
	optimisticFramesRef,
	hydratingRef,
}: {
	editor: Editor | null;
	updateItemFrames: (args: {
		updates: Array<
			WhiteboardFrame & {
				itemId: Id<"boardItems">;
			}
		>;
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

		if (queuedFrames.size === 0) return;

		void updateItemFrames({
			updates: [...queuedFrames].map(([itemId, sequencedFrame]) => ({
				itemId,
				...sequencedFrame.frame,
			})),
		}).catch(() => {
			const itemsToRehydrate: BoardItemResult[] = [];

			for (const [itemId, sequencedFrame] of queuedFrames) {
				const currentFrame = optimisticFramesRef.current.get(itemId);
				if (!shouldClearOptimisticFrame(currentFrame, sequencedFrame.seq)) {
					continue;
				}

				optimisticFramesRef.current.delete(itemId);
				const latestItem = latestItemsRef.current?.get(itemId);
				if (latestItem) itemsToRehydrate.push(latestItem);
			}

			if (!editor || itemsToRehydrate.length === 0) return;

			hydratingRef.current = true;
			editor.run(
				() => {
					for (const item of itemsToRehydrate) {
						rehydrateItemShape(editor, item);
					}
				},
				{ history: "ignore" },
			);
			window.setTimeout(() => {
				hydratingRef.current = false;
			}, 0);
		});
	}, [
		editor,
		hydratingRef,
		latestItemsRef,
		optimisticFramesRef,
		updateItemFrames,
	]);

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
