import { useCallback, useEffect, useRef } from "react";
import type { TLStoreSnapshot } from "tldraw";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TldrawDocumentResult } from "../whiteboard-canvas-helpers";

export function useDrawingSync({
	whiteboardId,
	tldrawDocument,
	saveTldrawDocument,
}: {
	whiteboardId: Id<"whiteboards"> | null;
	tldrawDocument: TldrawDocumentResult | undefined;
	saveTldrawDocument: (args: {
		whiteboardId: Id<"whiteboards"> | null;
		snapshot: TLStoreSnapshot;
		expectedRevision?: number;
	}) => Promise<{ revision: number }>;
}) {
	const pendingDrawingSaveRef = useRef<{
		whiteboardId: Id<"whiteboards"> | null;
		snapshot: TLStoreSnapshot;
		expectedRevision?: number;
	} | null>(null);
	const saveDrawingTimerRef = useRef<number | null>(null);
	const tldrawDocumentRevisionRef = useRef<number | null>(null);

	useEffect(() => {
		tldrawDocumentRevisionRef.current = tldrawDocument?.revision ?? null;
	}, [tldrawDocument?.revision]);

	const flushDrawingSave = useCallback(() => {
		saveDrawingTimerRef.current = null;
		const pendingSave = pendingDrawingSaveRef.current;
		pendingDrawingSaveRef.current = null;
		if (!pendingSave) return;

		void saveTldrawDocument({
			whiteboardId: pendingSave.whiteboardId,
			snapshot: pendingSave.snapshot,
			expectedRevision: pendingSave.expectedRevision,
		})
			.then(({ revision }) => {
				if (pendingSave.whiteboardId === whiteboardId) {
					tldrawDocumentRevisionRef.current = revision;
				}
			})
			.catch((error) => {
				console.warn("Failed to save tldraw document", error);
			});
	}, [saveTldrawDocument, whiteboardId]);

	const queueDrawingSave = useCallback(
		(snapshot: TLStoreSnapshot) => {
			pendingDrawingSaveRef.current = {
				whiteboardId,
				snapshot,
				expectedRevision: tldrawDocumentRevisionRef.current ?? undefined,
			};

			if (saveDrawingTimerRef.current !== null) {
				window.clearTimeout(saveDrawingTimerRef.current);
			}

			saveDrawingTimerRef.current = window.setTimeout(flushDrawingSave, 750);
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
