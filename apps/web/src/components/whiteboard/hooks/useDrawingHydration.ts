import { type MutableRefObject, useEffect, useRef, useState } from "react";
import type { Editor, TLRecord, TLStoreSnapshot } from "tldraw";
import {
	isManagedWhiteboardShapeRecord,
	planCanvasReconciliation,
	splitDeferredBindings,
} from "../tldraw-persistence";
import type { TldrawDocumentResult } from "../whiteboard-canvas-helpers";
import type { DrawingSaveState } from "./useDrawingSync";

export function useDrawingHydration({
	editor,
	whiteboardKey,
	tldrawDocument,
	hydratingRef,
	drawingSaveState,
	acknowledgeDrawingEcho,
}: {
	editor: Editor | null;
	whiteboardKey: string;
	tldrawDocument: TldrawDocumentResult | undefined;
	hydratingRef: MutableRefObject<boolean>;
	drawingSaveState: DrawingSaveState;
	acknowledgeDrawingEcho: (observedVersions: Record<string, number>) => boolean;
}) {
	const [loadedDrawingKey, setLoadedDrawingKey] = useState<string | null>(null);
	const [reconciliationGeneration, setReconciliationGeneration] = useState(0);
	const loadedDrawingKeyRef = useRef<string | null>(null);
	const emptyDrawingSnapshotRef = useRef<TLStoreSnapshot | null>(null);
	const deferredBindingsRef = useRef<unknown[]>([]);
	const appliedCanvasRecordIdsRef = useRef(new Set<string>());
	const latestDrawingSnapshotRef = useRef<TLStoreSnapshot | null>(null);

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
		appliedCanvasRecordIdsRef.current = new Set();
		latestDrawingSnapshotRef.current = null;
		if (snapshot) {
			// Bindings to managed cards reference shapes that are hydrated
			// separately (after this effect), so they're absent from the snapshot.
			// loadSnapshot would prune them; defer and re-attach once cards exist.
			const { snapshot: loadableSnapshot, deferredBindings } =
				splitDeferredBindings(snapshot);
			deferredBindingsRef.current = deferredBindings;
			editor.loadSnapshot(loadableSnapshot);
			appliedCanvasRecordIdsRef.current = persistedRecordIds(snapshot);
		}

		setLoadedDrawingKey(whiteboardKey);
		window.setTimeout(() => {
			hydratingRef.current = false;
		}, 0);
	}, [editor, hydratingRef, tldrawDocument, whiteboardKey]);

	useEffect(() => {
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		const snapshot =
			tldrawDocument?.snapshot ?? emptyDrawingSnapshotRef.current;
		if (!snapshot) return;
		latestDrawingSnapshotRef.current = snapshot;
		const localEchoCaughtUp = acknowledgeDrawingEcho(
			tldrawDocument?.canvasRecordVersions ?? {},
		);
		if (drawingSaveState.saving || !localEchoCaughtUp) return;

		const latestSnapshot = latestDrawingSnapshotRef.current;
		if (!latestSnapshot) return;
		latestDrawingSnapshotRef.current = null;
		const editorSnapshot = editor.store.getStoreSnapshot("document");
		const editorStore = editorSnapshot.store as unknown as Record<
			string,
			unknown
		>;
		const availableShapeIds = new Set(
			editor.getCurrentPageShapes().map((shape) => shape.id as string),
		);
		const reconciliation = planCanvasReconciliation({
			persistedStore: latestSnapshot.store as unknown as Record<
				string,
				unknown
			>,
			editorStore,
			previouslyAppliedRecordIds: appliedCanvasRecordIdsRef.current,
			availableShapeIds,
		});
		appliedCanvasRecordIdsRef.current = reconciliation.nextAppliedRecordIds;

		const persistedIds = reconciliation.nextAppliedRecordIds;
		const deferredById = new Map<string, TLRecord>();
		for (const record of deferredBindingsRef.current) {
			if (
				record &&
				typeof record === "object" &&
				"id" in record &&
				typeof record.id === "string" &&
				persistedIds.has(record.id)
			)
				deferredById.set(record.id, record as TLRecord);
		}
		for (const record of reconciliation.deferredBindings)
			deferredById.set(record.id, record);
		for (const record of reconciliation.upserts)
			if (record.typeName === "binding") deferredById.delete(record.id);
		deferredBindingsRef.current = [...deferredById.values()];

		if (
			reconciliation.removals.length === 0 &&
			reconciliation.upserts.length === 0
		) {
			setReconciliationGeneration((value) => value + 1);
			return;
		}

		hydratingRef.current = true;
		editor.run(
			() => {
				if (reconciliation.removals.length)
					editor.store.remove(reconciliation.removals as Array<TLRecord["id"]>);
				if (reconciliation.upserts.length)
					editor.store.put(reconciliation.upserts);
			},
			{ history: "ignore" },
		);
		setReconciliationGeneration((value) => value + 1);
		window.setTimeout(() => {
			hydratingRef.current = false;
		}, 0);
	}, [
		acknowledgeDrawingEcho,
		drawingSaveState.saving,
		editor,
		hydratingRef,
		loadedDrawingKey,
		tldrawDocument,
		whiteboardKey,
	]);

	return {
		loadedDrawingKey,
		setLoadedDrawingKey,
		loadedDrawingKeyRef,
		emptyDrawingSnapshotRef,
		deferredBindingsRef,
		appliedCanvasRecordIdsRef,
		latestDrawingSnapshotRef,
		reconciliationGeneration,
	};
}

function persistedRecordIds(snapshot: TLStoreSnapshot) {
	const ids = new Set<string>();
	for (const [id, record] of Object.entries(
		snapshot.store as unknown as Record<string, unknown>,
	)) {
		if (!isManagedWhiteboardShapeRecord(record)) ids.add(id);
	}
	return ids;
}
