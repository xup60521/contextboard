import {
	type MutableRefObject,
	type RefObject,
	useCallback,
	useRef,
} from "react";
import type { Editor } from "tldraw";
import {
	type SequencedFrame,
	shouldClearOptimisticFrame,
	type WhiteboardFrame,
} from "../frame-sync";
import type { Id } from "../ids";
import {
	type BoardItemResult,
	rehydrateItemShape,
} from "../whiteboard-canvas-helpers";

export function useFrameSync({
	editor,
	updateItemFrames,
	latestItemsRef,
	optimisticFramesRef,
	hydratingRef,
	interactionActiveRef,
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
	interactionActiveRef: MutableRefObject<boolean>;
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
		recordContextboardPerf("canvas.frame.write", {
			value: queuedFrames.size,
		});

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

	const pauseFramePersistence = useCallback(() => {
		if (flushTimerRef.current === null) return;
		window.clearTimeout(flushTimerRef.current);
		flushTimerRef.current = null;
	}, []);

	const queueFrameUpdate = useCallback(
		(itemId: Id<"boardItems">, frame: WhiteboardFrame) => {
			const sequencedFrame = {
				seq: frameUpdateSeqRef.current + 1,
				frame,
			};
			frameUpdateSeqRef.current = sequencedFrame.seq;
			queuedFrameUpdatesRef.current.set(itemId, sequencedFrame);
			optimisticFramesRef.current.set(itemId, sequencedFrame);

			if (interactionActiveRef.current) return;

			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
			}

			flushTimerRef.current = window.setTimeout(flushFrameUpdates, 250);
		},
		[flushFrameUpdates, interactionActiveRef, optimisticFramesRef],
	);

	return {
		flushFrameUpdates,
		pauseFramePersistence,
		queueFrameUpdate,
		queuedFrameUpdatesRef,
		flushTimerRef,
	};
}
import { recordContextboardPerf } from "@contextboard/application";
