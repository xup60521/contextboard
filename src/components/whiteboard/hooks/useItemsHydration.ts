import { useEffect, type MutableRefObject } from "react";
import type { Editor, TLRecord, TLShapeId } from "tldraw";
import type { Id } from "../../../../convex/_generated/dataModel";
import { frameFromItem, resolveFrameForHydration, type SequencedFrame } from "../frame-sync";
import {
	bothBindingEndpointsExist,
	isManagedWhiteboardShape,
	rehydrateItemShape,
	type BoardItemResult,
} from "../whiteboard-canvas-helpers";

export function useItemsHydration({
	editor,
	items,
	loadedDrawingKey,
	whiteboardKey,
	deferredBindingsRef,
	optimisticFramesRef,
	queuedFrameUpdatesRef,
	itemIdByShapeIdRef,
	latestItemsRef,
	pendingEditShapeIdRef,
	hydratingRef,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	deferredBindingsRef: MutableRefObject<unknown[]>;
	optimisticFramesRef: MutableRefObject<Map<Id<"boardItems">, SequencedFrame>>;
	queuedFrameUpdatesRef: MutableRefObject<Map<Id<"boardItems">, SequencedFrame>>;
	itemIdByShapeIdRef: MutableRefObject<Map<string, Id<"boardItems">>>;
	latestItemsRef: MutableRefObject<Map<Id<"boardItems">, BoardItemResult>>;
	pendingEditShapeIdRef: MutableRefObject<TLShapeId | null>;
	hydratingRef: MutableRefObject<boolean>;
}) {
	// Sync Convex board items → tldraw shapes
	// biome-ignore lint/correctness/useExhaustiveDependencies: items drives this; all refs are stable
	useEffect(() => {
		if (!editor) return;
		if (loadedDrawingKey !== whiteboardKey) return;

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
		const currentManagedShapes = editor
			.getCurrentPageShapes()
			.filter(isManagedWhiteboardShape);

		hydratingRef.current = true;
		editor.run(
			() => {
				const staleShapeIds = currentManagedShapes
					.filter((shape) => !wantedShapeIds.has(shape.id))
					.map((shape) => shape.id);

				if (staleShapeIds.length > 0) {
					editor.deleteShapes(staleShapeIds);
				}

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

		window.setTimeout(() => {
			hydratingRef.current = false;
			const pendingEditShapeId = pendingEditShapeIdRef.current;
			if (!pendingEditShapeId || !editor.getShape(pendingEditShapeId)) return;

			pendingEditShapeIdRef.current = null;
			editor.select(pendingEditShapeId);
			editor.setEditingShape(pendingEditShapeId);
		}, 0);
	}, [editor, items, loadedDrawingKey, whiteboardKey]);

	// Re-attach bindings deferred at load once both endpoints exist
	// biome-ignore lint/correctness/useExhaustiveDependencies: items re-runs this after hydration creates the bound card shapes
	useEffect(() => {
		if (!editor) return;
		if (loadedDrawingKey !== whiteboardKey) return;
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
		editor.run(
			() => {
				editor.store.put(ready);
			},
			{ history: "ignore" },
		);
		window.setTimeout(() => {
			hydratingRef.current = false;
		}, 0);
	}, [editor, items, loadedDrawingKey, whiteboardKey]);
}
