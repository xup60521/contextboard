import { recordContextboardPerf } from "@contextboard/application";
import { type MutableRefObject, useEffect } from "react";
import type { Editor, TLRecord, TLShapeId } from "tldraw";
import {
	frameFromItem,
	resolveFrameForHydration,
	type SequencedFrame,
} from "../frame-sync";
import type { Id } from "../ids";
import {
	type BoardItemResult,
	bothBindingEndpointsExist,
	isManagedWhiteboardShape,
	isMarkdownCardShape,
	rehydrateItemShape,
} from "../whiteboard-canvas-helpers";

export function getStaleManagedShapeIds(
	currentManagedShapes: ReadonlyArray<{ id: string }>,
	wantedShapeIds: ReadonlySet<string>,
	protectedShapeIds: ReadonlySet<string>,
) {
	return currentManagedShapes
		.filter(
			(shape) =>
				!wantedShapeIds.has(shape.id) && !protectedShapeIds.has(shape.id),
		)
		.map((shape) => shape.id);
}

export function useItemsHydration({
	editor,
	items,
	itemsReady,
	loadedDrawingKey,
	whiteboardKey,
	deferredBindingsRef,
	optimisticFramesRef,
	queuedFrameUpdatesRef,
	itemIdByShapeIdRef,
	latestItemsRef,
	pendingEditShapeIdRef,
	prioritizeCardContent,
	scheduleVisibleCardHydration,
	hydratingRef,
	protectedPasteShapeIdsRef,
	reconciliationGeneration,
	readOnly = false,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	itemsReady: boolean;
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	deferredBindingsRef: MutableRefObject<unknown[]>;
	optimisticFramesRef: MutableRefObject<Map<Id<"boardItems">, SequencedFrame>>;
	queuedFrameUpdatesRef: MutableRefObject<
		Map<Id<"boardItems">, SequencedFrame>
	>;
	itemIdByShapeIdRef: MutableRefObject<Map<string, Id<"boardItems">>>;
	latestItemsRef: MutableRefObject<Map<Id<"boardItems">, BoardItemResult>>;
	pendingEditShapeIdRef: MutableRefObject<TLShapeId | null>;
	prioritizeCardContent: (shapeId: TLShapeId, cardId: Id<"cards">) => void;
	scheduleVisibleCardHydration: () => void;
	hydratingRef: MutableRefObject<boolean>;
	protectedPasteShapeIdsRef: MutableRefObject<Set<string>>;
	reconciliationGeneration: number;
	readOnly?: boolean;
}) {
	// Sync persisted board items → tldraw shapes
	// biome-ignore lint/correctness/useExhaustiveDependencies: items drives this; all refs are stable
	useEffect(() => {
		if (!editor) return;
		if (loadedDrawingKey !== whiteboardKey) return;
		if (!itemsReady) return;

		const itemIdByShapeId = new Map<string, Id<"boardItems">>();
		const latestItems = new Map<Id<"boardItems">, BoardItemResult>();
		const wantedItemIds = new Set<Id<"boardItems">>();
		for (const item of items) {
			itemIdByShapeId.set(item.shapeId, item._id);
			latestItems.set(item._id, item);
			wantedItemIds.add(item._id);
		}
		itemIdByShapeIdRef.current = itemIdByShapeId;
		latestItemsRef.current = latestItems;

		for (const itemId of optimisticFramesRef.current.keys()) {
			if (!wantedItemIds.has(itemId)) {
				optimisticFramesRef.current.delete(itemId);
			}
		}
		for (const itemId of queuedFrameUpdatesRef.current.keys()) {
			if (!wantedItemIds.has(itemId)) {
				queuedFrameUpdatesRef.current.delete(itemId);
			}
		}

		const wantedShapeIds = new Set(items.map((item) => item.shapeId));
		for (const shapeId of protectedPasteShapeIdsRef.current) {
			if (wantedShapeIds.has(shapeId)) {
				protectedPasteShapeIdsRef.current.delete(shapeId);
			}
		}
		const currentManagedShapes = editor
			.getCurrentPageShapes()
			.filter(isManagedWhiteboardShape);
		const currentManagedShapeIds = new Set(
			currentManagedShapes.map((shape) => shape.id as string),
		);

		hydratingRef.current = true;
		const restoreReadOnly = readOnly && editor.getIsReadonly();
		if (restoreReadOnly) editor.updateInstanceState({ isReadonly: false });
		try {
			editor.run(
				() => {
				const staleShapeIds = getStaleManagedShapeIds(
					currentManagedShapes,
					wantedShapeIds,
					protectedPasteShapeIdsRef.current,
				);

				if (staleShapeIds.length > 0) {
					recordContextboardPerf("canvas.shape.deleted", {
						value: staleShapeIds.length,
					});
					editor.deleteShapes(staleShapeIds as TLShapeId[]);
				}
				const createCount = items.filter(
					(item) => !currentManagedShapeIds.has(item.shapeId),
				).length;
				if (createCount > 0)
					recordContextboardPerf("canvas.shape.created", {
						value: createCount,
					});

				for (const item of items) {
					const serverFrame = frameFromItem(item);
					const optimisticFrame = optimisticFramesRef.current.get(item._id);
					const frameResolution = resolveFrameForHydration(
						serverFrame,
						optimisticFrame,
					);

					if (frameResolution.acknowledged) {
						optimisticFramesRef.current.delete(item._id);
					}

					rehydrateItemShape(editor, item, frameResolution.frame);
				}
				},
				{ history: "ignore" },
			);
		} finally {
			if (restoreReadOnly) editor.updateInstanceState({ isReadonly: true });
		}

		window.setTimeout(() => {
			hydratingRef.current = false;
			scheduleVisibleCardHydration();
			const pendingEditShapeId = pendingEditShapeIdRef.current;
			if (!pendingEditShapeId || !editor.getShape(pendingEditShapeId)) return;

			const pendingShape = editor.getShape(pendingEditShapeId);
			if (
				pendingShape &&
				isMarkdownCardShape(pendingShape) &&
				pendingShape.props.cardId
			) {
				prioritizeCardContent(
					pendingEditShapeId,
					pendingShape.props.cardId as Id<"cards">,
				);
				return;
			}

			pendingEditShapeIdRef.current = null;
			editor.select(pendingEditShapeId);
			editor.setEditingShape(pendingEditShapeId);
		}, 0);
	}, [
		editor,
		items,
		itemsReady,
		loadedDrawingKey,
		prioritizeCardContent,
		readOnly,
		scheduleVisibleCardHydration,
		whiteboardKey,
	]);

	// Re-attach bindings deferred at load once both endpoints exist
	// biome-ignore lint/correctness/useExhaustiveDependencies: items re-runs this after hydration creates the bound card shapes
	useEffect(() => {
		if (!editor) return;
		if (loadedDrawingKey !== whiteboardKey) return;
		if (!itemsReady) return;
		if (deferredBindingsRef.current.length === 0) return;

		const ready: TLRecord[] = [];
		const stillPending: unknown[] = [];
		for (const binding of deferredBindingsRef.current) {
			if (bothBindingEndpointsExist(editor, binding)) {
				ready.push(binding as TLRecord);
			} else {
				stillPending.push(binding);
			}
		}

		deferredBindingsRef.current = stillPending;
		if (ready.length === 0) return;

		hydratingRef.current = true;
		editor.store.mergeRemoteChanges(() => {
			editor.store.put(ready);
		});
		window.setTimeout(() => {
			hydratingRef.current = false;
		}, 0);
	}, [
		editor,
		items,
		itemsReady,
		loadedDrawingKey,
		reconciliationGeneration,
		whiteboardKey,
	]);
}
