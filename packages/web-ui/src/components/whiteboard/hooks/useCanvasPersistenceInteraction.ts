import { type MutableRefObject, useEffect, useRef } from "react";
import type { Editor, TLEventInfo } from "tldraw";

/**
 * Keeps persistence out of the pointer-move path. Tldraw updates its store
 * optimistically while an interaction is active; the persistence hooks keep
 * the latest values in refs and this lifecycle flushes them after release.
 */
export function useCanvasPersistenceInteraction({
	editor,
	interactionActiveRef,
	pauseFramePersistence,
	flushFrameUpdates,
	pauseDrawingPersistence,
	flushDrawingSave,
}: {
	editor: Editor | null;
	interactionActiveRef: MutableRefObject<boolean>;
	pauseFramePersistence: () => void;
	flushFrameUpdates: () => void;
	pauseDrawingPersistence: () => void;
	flushDrawingSave: () => Promise<void>;
}) {
	const activePointerIdsRef = useRef(new Set<number>());
	const flushScheduledRef = useRef(false);

	useEffect(() => {
		if (!editor) return;

		const pausePersistence = () => {
			interactionActiveRef.current = true;
			pauseFramePersistence();
			pauseDrawingPersistence();
		};

		const flushPersistence = () => {
			activePointerIdsRef.current.clear();
			if (!interactionActiveRef.current) return;
			interactionActiveRef.current = false;

			// The final pointer-up can cause one last tldraw store change. Flush in
			// a microtask so that change is included in the release batch.
			if (flushScheduledRef.current) return;
			flushScheduledRef.current = true;
			queueMicrotask(() => {
				flushScheduledRef.current = false;
				if (interactionActiveRef.current) return;
				flushFrameUpdates();
				void flushDrawingSave().catch(() => undefined);
			});
		};

		const handleEvent = (info: TLEventInfo) => {
			if (info.type === "pointer") {
				if (info.name === "pointer_down") {
					if (activePointerIdsRef.current.size === 0) pausePersistence();
					activePointerIdsRef.current.add(info.pointerId);
					return;
				}

				if (info.name === "pointer_up") {
					activePointerIdsRef.current.delete(info.pointerId);
					if (activePointerIdsRef.current.size === 0) flushPersistence();
				}
				return;
			}

			if (
				info.type === "misc" &&
				(info.name === "cancel" ||
					info.name === "interrupt" ||
					info.name === "complete")
			) {
				flushPersistence();
			}
		};

		editor.on("event", handleEvent);
		return () => {
			editor.off("event", handleEvent);
			activePointerIdsRef.current.clear();
			interactionActiveRef.current = false;
			pauseFramePersistence();
			pauseDrawingPersistence();
			flushFrameUpdates();
			void flushDrawingSave().catch(() => undefined);
		};
	}, [
		editor,
		flushDrawingSave,
		flushFrameUpdates,
		interactionActiveRef,
		pauseDrawingPersistence,
		pauseFramePersistence,
	]);
}
