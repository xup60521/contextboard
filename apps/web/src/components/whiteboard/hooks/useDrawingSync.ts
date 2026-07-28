import { useCallback, useRef } from "react";
import type { Id } from "#/integrations/local/types";

export type CanvasRecordDelta = {
	added: unknown[];
	updated: unknown[];
	removed: string[];
};

export function useDrawingSync({
	whiteboardId,
	applyCanvasRecordChanges,
}: {
	whiteboardId: Id<"whiteboards"> | null;
	applyCanvasRecordChanges: (
		args: CanvasRecordDelta & {
			whiteboardId: Id<"whiteboards"> | null;
		},
	) => Promise<unknown>;
}) {
	const pendingDrawingSaveRef = useRef<{
		whiteboardId: Id<"whiteboards"> | null;
		delta: CanvasRecordDelta;
	} | null>(null);
	const saveDrawingTimerRef = useRef<number | null>(null);

	const flushDrawingSave = useCallback(() => {
		saveDrawingTimerRef.current = null;
		const pendingSave = pendingDrawingSaveRef.current;
		pendingDrawingSaveRef.current = null;
		if (!pendingSave) return;

		void applyCanvasRecordChanges({
			whiteboardId: pendingSave.whiteboardId,
			...pendingSave.delta,
		}).catch((error) => {
			console.warn("Failed to save tldraw record changes", error);
		});
	}, [applyCanvasRecordChanges]);

	const queueDrawingSave = useCallback(
		(delta: CanvasRecordDelta) => {
			const previous = pendingDrawingSaveRef.current?.delta;
			pendingDrawingSaveRef.current = {
				whiteboardId,
				delta: {
					added: [...(previous?.added ?? []), ...delta.added],
					updated: [...(previous?.updated ?? []), ...delta.updated],
					removed: [
						...new Set([...(previous?.removed ?? []), ...delta.removed]),
					],
				},
			};

			if (saveDrawingTimerRef.current !== null) {
				window.clearTimeout(saveDrawingTimerRef.current);
			}

			saveDrawingTimerRef.current = window.setTimeout(flushDrawingSave, 500);
		},
		[flushDrawingSave, whiteboardId],
	);

	return {
		flushDrawingSave,
		queueDrawingSave,
		pendingDrawingSaveRef,
		saveDrawingTimerRef,
	};
}
