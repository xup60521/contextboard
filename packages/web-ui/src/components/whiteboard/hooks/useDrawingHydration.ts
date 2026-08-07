import type { CanvasRecordPatch } from "@contextboard/application";
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { Editor, TLRecord, TLStoreSnapshot } from "tldraw";
import type { Id } from "../ids";
import {
	DrawingSnapshotValidationError,
	isManagedWhiteboardShapeRecord,
	planCanvasReconciliation,
	resolveHydrationSnapshot,
	splitDeferredBindings,
} from "../tldraw-persistence";
import type { TldrawDocumentResult } from "../whiteboard-canvas-helpers";
import type { DrawingSaveState } from "./useDrawingSync";

export type DrawingHydrationError = {
	whiteboardKey: string;
	stage: "identity" | "normalize" | "migrate" | "load";
	message: string;
};

export function useDrawingHydration({
	editor,
	whiteboardId,
	whiteboardKey,
	tldrawDocument,
	documentPatches = [],
	reloadDocument,
	itemsReady,
	hydratingRef,
	drawingSaveState,
	acknowledgeDrawingEcho,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	whiteboardKey: string;
	tldrawDocument: TldrawDocumentResult | undefined;
	documentPatches: CanvasRecordPatch[];
	reloadDocument?: () => void;
	itemsReady: boolean;
	hydratingRef: MutableRefObject<boolean>;
	drawingSaveState: DrawingSaveState;
	acknowledgeDrawingEcho: (observedVersions: Record<string, number>) => boolean;
}) {
	const [loadedDrawingKey, setLoadedDrawingKey] = useState<string | null>(null);
	const [reconciliationGeneration, setReconciliationGeneration] = useState(0);
	const [hydrationError, setHydrationError] =
		useState<DrawingHydrationError | null>(null);
	const [retryGeneration, setRetryGeneration] = useState(0);
	const loadedDrawingKeyRef = useRef<string | null>(null);
	const emptyDrawingSnapshotRef = useRef<TLStoreSnapshot | null>(null);
	const deferredBindingsRef = useRef<unknown[]>([]);
	const appliedCanvasRecordIdsRef = useRef(new Set<string>());
	const appliedCanvasRecordVersionsRef = useRef<Record<string, number>>({});
	const latestDrawingSnapshotRef = useRef<TLStoreSnapshot | null>(null);
	const activeWhiteboardKeyRef = useRef(whiteboardKey);
	const hydrationGenerationRef = useRef(0);
	const appliedPatchCountRef = useRef(0);

	if (activeWhiteboardKeyRef.current !== whiteboardKey) {
		activeWhiteboardKeyRef.current = whiteboardKey;
		hydrationGenerationRef.current += 1;
	}

	useEffect(() => {
		loadedDrawingKeyRef.current = loadedDrawingKey;
	}, [loadedDrawingKey]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: whiteboardKey intentionally resets per-board state
	useEffect(() => {
		loadedDrawingKeyRef.current = null;
		appliedPatchCountRef.current = 0;
		setLoadedDrawingKey(null);
		setHydrationError(null);
	}, [whiteboardKey]);

	useEffect(() => {
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		const pending = documentPatches.slice(appliedPatchCountRef.current);
		if (pending.length === 0) return;
		const latest = new Map<
			string,
			{ payload?: unknown; revision: number; removed: boolean }
		>();
		for (const patch of pending) {
			if (patch.whiteboardId !== whiteboardId) continue;
			for (const row of patch.upserts) {
				const prior = latest.get(row.recordId);
				if (!prior || row.revision >= prior.revision)
					latest.set(row.recordId, {
						payload: row.payload,
						revision: row.revision,
						removed: false,
					});
			}
			for (const row of patch.removals) {
				const prior = latest.get(row.recordId);
				if (!prior || row.revision >= prior.revision)
					latest.set(row.recordId, { revision: row.revision, removed: true });
			}
		}
		appliedPatchCountRef.current = documentPatches.length;
		const upserts: TLRecord[] = [];
		const removals: TLRecord["id"][] = [];
		const patchIds = new Set(
			[...latest.entries()]
				.filter(([, change]) => !change.removed)
				.map(([recordId]) => recordId),
		);
		for (const [recordId, change] of latest) {
			const appliedRevision =
				appliedCanvasRecordVersionsRef.current[recordId] ?? 0;
			if (change.revision > 0 && change.revision <= appliedRevision) continue;
			if (change.removed) removals.push(recordId as TLRecord["id"]);
			else if (change.payload && typeof change.payload === "object") {
				const record = change.payload as TLRecord & {
					fromId?: string;
					toId?: string;
				};
				const endpointMissing =
					record.typeName === "binding" &&
					[record.fromId, record.toId].some(
						(id) =>
							typeof id === "string" &&
							!patchIds.has(id) &&
							!editor.store.has(id as TLRecord["id"]),
					);
				if (endpointMissing) {
					const deferred = new Map(
						deferredBindingsRef.current
							.filter(
								(value): value is TLRecord =>
									!!value && typeof value === "object" && "id" in value,
							)
							.map((value) => [value.id, value]),
					);
					deferred.set(record.id, record);
					deferredBindingsRef.current = [...deferred.values()];
				} else upserts.push(record);
			}
			appliedCanvasRecordVersionsRef.current[recordId] = change.revision;
		}
		if (upserts.length === 0 && removals.length === 0) return;
		hydratingRef.current = true;
		try {
			editor.run(
				() => {
					if (removals.length) editor.store.remove(removals);
					if (upserts.length) editor.store.put(upserts);
				},
				{ history: "ignore" },
			);
			setReconciliationGeneration((value) => value + 1);
		} catch (error) {
			console.error("Failed to apply incremental drawing patch", {
				whiteboardKey,
				error,
			});
			reloadDocument?.();
		} finally {
			window.setTimeout(() => {
				hydratingRef.current = false;
			}, 0);
		}
	}, [
		documentPatches,
		editor,
		hydratingRef,
		loadedDrawingKey,
		reloadDocument,
		whiteboardId,
		whiteboardKey,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryGeneration intentionally retriggers hydration
	useEffect(() => {
		if (!editor || tldrawDocument === undefined || !itemsReady) return;
		if (loadedDrawingKeyRef.current === whiteboardKey) return;

		const generation = hydrationGenerationRef.current;
		if (tldrawDocument && tldrawDocument.whiteboardId !== whiteboardId) {
			setHydrationError({
				whiteboardKey,
				stage: "identity",
				message: "Drawing data belongs to a different whiteboard.",
			});
			return;
		}

		const currentEmptySnapshot = emptyDrawingSnapshotRef.current;
		if (!currentEmptySnapshot) return;

		deferredBindingsRef.current = [];
		appliedCanvasRecordIdsRef.current = new Set();
		appliedCanvasRecordVersionsRef.current = {};
		latestDrawingSnapshotRef.current = null;
		setHydrationError(null);

		try {
			const snapshot = resolveHydrationSnapshot({
				persistedSnapshot: tldrawDocument?.snapshot ?? currentEmptySnapshot,
				currentEmptySnapshot,
			});
			// Bindings to managed cards reference shapes that are hydrated
			// separately (after this effect), so they're absent from the snapshot.
			// loadSnapshot would prune them; defer and re-attach once cards exist.
			const { snapshot: loadableSnapshot, deferredBindings } =
				splitDeferredBindings(snapshot);
			hydratingRef.current = true;
			editor.loadSnapshot(loadableSnapshot);
			if (hydrationGenerationRef.current !== generation) return;

			deferredBindingsRef.current = deferredBindings;
			appliedCanvasRecordIdsRef.current = persistedRecordIds(snapshot);
			appliedCanvasRecordVersionsRef.current = {
				...(tldrawDocument?.canvasRecordVersions ?? {}),
			};
			latestDrawingSnapshotRef.current = snapshot;
			loadedDrawingKeyRef.current = whiteboardKey;
			setLoadedDrawingKey(whiteboardKey);
			window.setTimeout(() => {
				if (hydrationGenerationRef.current === generation)
					hydratingRef.current = false;
			}, 0);
		} catch (error) {
			if (hydrationGenerationRef.current !== generation) return;
			hydratingRef.current = false;
			const hydrationFailure = toDrawingHydrationError(error, whiteboardKey);
			setHydrationError(hydrationFailure);
			console.error("Failed to hydrate whiteboard drawing", {
				whiteboardKey,
				stage: hydrationFailure.stage,
				recordId:
					error instanceof DrawingSnapshotValidationError
						? error.recordId
						: null,
				recordType:
					error instanceof DrawingSnapshotValidationError
						? error.recordType
						: null,
				error,
			});
		}
	}, [
		editor,
		hydratingRef,
		itemsReady,
		retryGeneration,
		tldrawDocument,
		whiteboardId,
		whiteboardKey,
	]);

	useEffect(() => {
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		if (tldrawDocument && tldrawDocument.whiteboardId !== whiteboardId) return;
		const currentEmptySnapshot = emptyDrawingSnapshotRef.current;
		if (!currentEmptySnapshot) return;
		let snapshot: TLStoreSnapshot;
		try {
			snapshot = resolveHydrationSnapshot({
				persistedSnapshot: tldrawDocument?.snapshot ?? currentEmptySnapshot,
				currentEmptySnapshot,
			});
		} catch (error) {
			const hydrationFailure = toDrawingHydrationError(error, whiteboardKey);
			setHydrationError(hydrationFailure);
			console.error("Failed to normalize whiteboard drawing update", {
				whiteboardKey,
				stage: hydrationFailure.stage,
				recordId:
					error instanceof DrawingSnapshotValidationError
						? error.recordId
						: null,
				recordType:
					error instanceof DrawingSnapshotValidationError
						? error.recordType
						: null,
				error,
			});
			return;
		}
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
			previouslyAppliedRecordVersions: appliedCanvasRecordVersionsRef.current,
			persistedRecordVersions: tldrawDocument?.canvasRecordVersions,
			availableShapeIds,
		});
		appliedCanvasRecordIdsRef.current = reconciliation.nextAppliedRecordIds;
		appliedCanvasRecordVersionsRef.current = {
			...(tldrawDocument?.canvasRecordVersions ?? {}),
		};

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
		try {
			editor.run(
				() => {
					if (reconciliation.removals.length)
						editor.store.remove(
							reconciliation.removals as Array<TLRecord["id"]>,
						);
					if (reconciliation.upserts.length)
						editor.store.put(reconciliation.upserts);
				},
				{ history: "ignore" },
			);
		} catch (error) {
			hydratingRef.current = false;
			const hydrationFailure = toDrawingHydrationError(error, whiteboardKey);
			setHydrationError(hydrationFailure);
			console.error("Failed to reconcile whiteboard drawing", {
				whiteboardKey,
				stage: hydrationFailure.stage,
				error,
			});
			return;
		}
		setReconciliationGeneration((value) => value + 1);
		const generation = hydrationGenerationRef.current;
		window.setTimeout(() => {
			if (hydrationGenerationRef.current === generation)
				hydratingRef.current = false;
		}, 0);
	}, [
		acknowledgeDrawingEcho,
		drawingSaveState.saving,
		editor,
		hydratingRef,
		loadedDrawingKey,
		tldrawDocument,
		whiteboardId,
		whiteboardKey,
	]);

	const retryDrawingHydration = useCallback(() => {
		hydrationGenerationRef.current += 1;
		loadedDrawingKeyRef.current = null;
		setLoadedDrawingKey(null);
		setHydrationError(null);
		setRetryGeneration((value) => value + 1);
	}, []);

	return {
		loadedDrawingKey,
		setLoadedDrawingKey,
		loadedDrawingKeyRef,
		emptyDrawingSnapshotRef,
		deferredBindingsRef,
		appliedCanvasRecordIdsRef,
		latestDrawingSnapshotRef,
		reconciliationGeneration,
		hydrationError,
		retryDrawingHydration,
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

function toDrawingHydrationError(
	error: unknown,
	whiteboardKey: string,
): DrawingHydrationError {
	const message = error instanceof Error ? error.message : String(error);
	return {
		whiteboardKey,
		stage:
			error instanceof DrawingSnapshotValidationError
				? "normalize"
				: /migrat/i.test(message)
					? "migrate"
					: "load",
		message,
	};
}
