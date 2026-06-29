import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Editor, TLStoreSnapshot } from "tldraw";
import { splitDeferredBindings } from "../tldraw-persistence";
import type { TldrawDocumentResult } from "../whiteboard-canvas-helpers";

export function useDrawingHydration({
	editor,
	whiteboardKey,
	tldrawDocument,
	hydratingRef,
}: {
	editor: Editor | null;
	whiteboardKey: string;
	tldrawDocument: TldrawDocumentResult | undefined;
	hydratingRef: MutableRefObject<boolean>;
}) {
	const [loadedDrawingKey, setLoadedDrawingKey] = useState<string | null>(null);
	const loadedDrawingKeyRef = useRef<string | null>(null);
	const emptyDrawingSnapshotRef = useRef<TLStoreSnapshot | null>(null);
	const deferredBindingsRef = useRef<unknown[]>([]);

	useEffect(() => {
		loadedDrawingKeyRef.current = loadedDrawingKey;
	}, [loadedDrawingKey]);

	useEffect(() => {
		if (!editor || tldrawDocument === undefined) return;
		if (loadedDrawingKeyRef.current === whiteboardKey) return;

		const snapshot =
			tldrawDocument?.snapshot ?? emptyDrawingSnapshotRef.current;
		hydratingRef.current = true;
		deferredBindingsRef.current = [];
		if (snapshot) {
			// Bindings to managed cards reference shapes that are hydrated
			// separately (after this effect), so they're absent from the snapshot.
			// loadSnapshot would prune them; defer and re-attach once cards exist.
			const { snapshot: loadableSnapshot, deferredBindings } =
				splitDeferredBindings(snapshot);
			deferredBindingsRef.current = deferredBindings;
			editor.loadSnapshot(loadableSnapshot);
		}

		setLoadedDrawingKey(whiteboardKey);
		window.setTimeout(() => {
			hydratingRef.current = false;
		}, 0);
	}, [editor, hydratingRef, tldrawDocument, whiteboardKey]);

	return {
		loadedDrawingKey,
		setLoadedDrawingKey,
		loadedDrawingKeyRef,
		emptyDrawingSnapshotRef,
		deferredBindingsRef,
	};
}
