import { useCallback, useRef, useState } from "react";
import type { Id } from "../ids";

export type CanvasRecordDelta = {
	added: unknown[];
	updated: unknown[];
	removed: string[];
};

export type DrawingSaveState = {
	pending: boolean;
	saving: boolean;
	awaitingEcho: boolean;
	generation: number;
};

type CanvasRecordSaveResult = {
	versions?: Record<string, number>;
};

function recordId(record: unknown) {
	return record &&
		typeof record === "object" &&
		"id" in record &&
		typeof record.id === "string"
		? record.id
		: null;
}

export function mergeCanvasRecordDeltas(
	previous: CanvasRecordDelta | undefined,
	next: CanvasRecordDelta,
): CanvasRecordDelta {
	const added = new Map<string, unknown>();
	const updated = new Map<string, unknown>();
	const removed = new Set<string>();
	const canceledAdditions = new Set<string>();

	for (const record of previous?.added ?? []) {
		const id = recordId(record);
		if (id) added.set(id, record);
	}
	for (const record of previous?.updated ?? []) {
		const id = recordId(record);
		if (id) updated.set(id, record);
	}
	for (const id of previous?.removed ?? []) removed.add(id);

	for (const record of next.added) {
		const id = recordId(record);
		if (!id) continue;
		removed.delete(id);
		updated.delete(id);
		added.set(id, record);
	}
	for (const record of next.updated) {
		const id = recordId(record);
		if (!id) continue;
		removed.delete(id);
		if (added.has(id)) added.set(id, record);
		else updated.set(id, record);
	}
	for (const id of next.removed) {
		if (added.delete(id)) {
			updated.delete(id);
			removed.delete(id);
			canceledAdditions.add(id);
			continue;
		}
		if (canceledAdditions.has(id)) continue;
		updated.delete(id);
		removed.add(id);
	}

	return {
		added: [...added.values()],
		updated: [...updated.values()],
		removed: [...removed],
	};
}

export function useDrawingSync({
	whiteboardId,
	applyCanvasRecordChanges,
}: {
	whiteboardId: Id<"whiteboards"> | null;
	applyCanvasRecordChanges: (
		args: CanvasRecordDelta & {
			whiteboardId: Id<"whiteboards"> | null;
		},
	) => Promise<CanvasRecordSaveResult>;
}) {
	const pendingDrawingSaveRef = useRef<{
		whiteboardId: Id<"whiteboards"> | null;
		delta: CanvasRecordDelta;
	} | null>(null);
	const saveDrawingTimerRef = useRef<number | null>(null);
	const saveChainRef = useRef<Promise<void>>(Promise.resolve());
	const inFlightSaveCountRef = useRef(0);
	const awaitingEchoVersionsRef = useRef(new Map<string, number>());
	const currentWhiteboardIdRef = useRef(whiteboardId);
	currentWhiteboardIdRef.current = whiteboardId;
	const [drawingSaveState, setDrawingSaveState] = useState<DrawingSaveState>({
		pending: false,
		saving: false,
		awaitingEcho: false,
		generation: 0,
	});

	const updatePendingState = useCallback(() => {
		const saving =
			pendingDrawingSaveRef.current !== null ||
			inFlightSaveCountRef.current > 0;
		const awaitingEcho = awaitingEchoVersionsRef.current.size > 0;
		setDrawingSaveState((state) =>
			state.saving === saving && state.awaitingEcho === awaitingEcho
				? state
				: {
						...state,
						pending: saving || awaitingEcho,
						saving,
						awaitingEcho,
					},
		);
	}, []);

	const acknowledgeDrawingEcho = useCallback(
		(observedVersions: Record<string, number>) => {
			for (const [
				recordId,
				expectedRevision,
			] of awaitingEchoVersionsRef.current) {
				if ((observedVersions[recordId] ?? 0) >= expectedRevision)
					awaitingEchoVersionsRef.current.delete(recordId);
			}
			const caughtUp = awaitingEchoVersionsRef.current.size === 0;
			updatePendingState();
			return caughtUp;
		},
		[updatePendingState],
	);

	const flushDrawingSave = useCallback((): Promise<void> => {
		if (saveDrawingTimerRef.current !== null) {
			window.clearTimeout(saveDrawingTimerRef.current);
			saveDrawingTimerRef.current = null;
		}
		const pendingSave = pendingDrawingSaveRef.current;
		pendingDrawingSaveRef.current = null;
		if (!pendingSave) return saveChainRef.current;

		inFlightSaveCountRef.current += 1;
		updatePendingState();
		const attempt = saveChainRef.current
			.catch(() => undefined)
			.then(() =>
				applyCanvasRecordChanges({
					whiteboardId: pendingSave.whiteboardId,
					...pendingSave.delta,
				}),
			)
			.then(
				(result) => {
					if (pendingSave.whiteboardId === currentWhiteboardIdRef.current) {
						for (const [recordId, revision] of Object.entries(
							result.versions ?? {},
						)) {
							awaitingEchoVersionsRef.current.set(
								recordId,
								Math.max(
									revision,
									awaitingEchoVersionsRef.current.get(recordId) ?? 0,
								),
							);
						}
					}
				},
				(error) => {
					const queued = pendingDrawingSaveRef.current;
					pendingDrawingSaveRef.current = {
						whiteboardId: pendingSave.whiteboardId,
						delta: mergeCanvasRecordDeltas(
							pendingSave.delta,
							queued?.whiteboardId === pendingSave.whiteboardId
								? queued.delta
								: {
										added: [],
										updated: [],
										removed: [],
									},
						),
					};
					console.warn("Failed to save tldraw record changes", error);
					throw error;
				},
			)
			.finally(() => {
				inFlightSaveCountRef.current -= 1;
				setDrawingSaveState((state) => ({
					pending:
						pendingDrawingSaveRef.current !== null ||
						inFlightSaveCountRef.current > 0 ||
						awaitingEchoVersionsRef.current.size > 0,
					saving:
						pendingDrawingSaveRef.current !== null ||
						inFlightSaveCountRef.current > 0,
					awaitingEcho: awaitingEchoVersionsRef.current.size > 0,
					generation: state.generation + 1,
				}));
			});
		saveChainRef.current = attempt;
		return attempt;
	}, [applyCanvasRecordChanges, updatePendingState]);

	const queueDrawingSave = useCallback(
		(delta: CanvasRecordDelta) => {
			if (!whiteboardId) return;
			const previous = pendingDrawingSaveRef.current;
			pendingDrawingSaveRef.current = {
				whiteboardId,
				delta: mergeCanvasRecordDeltas(
					previous?.whiteboardId === whiteboardId ? previous.delta : undefined,
					delta,
				),
			};
			updatePendingState();

			if (saveDrawingTimerRef.current !== null)
				window.clearTimeout(saveDrawingTimerRef.current);
			saveDrawingTimerRef.current = window.setTimeout(
				() => void flushDrawingSave().catch(() => undefined),
				500,
			);
		},
		[flushDrawingSave, updatePendingState, whiteboardId],
	);

	return {
		flushDrawingSave,
		queueDrawingSave,
		pendingDrawingSaveRef,
		saveDrawingTimerRef,
		drawingSaveState,
		acknowledgeDrawingEcho,
	};
}
