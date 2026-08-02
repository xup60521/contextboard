import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useEffect,
} from "react";
import type { Editor, TLShapeId } from "tldraw";
import type { MarkdownCardShape } from "../custom-shapes";
import type { WhiteboardFrame } from "../frame-sync";
import type { Id } from "../ids";
import { forgetMeasuredCardHeight } from "../measured-card-heights";
import {
	hasManagedShapeFrameChanged,
	hasPersistableDrawingChange,
	isManagedWhiteboardShape,
	type ManagedWhiteboardShape,
} from "../whiteboard-canvas-helpers";
import type { CanvasRecordDelta } from "./useDrawingSync";

export function useStoreListener({
	editor,
	whiteboardId,
	hydratingRef,
	itemIdByShapeIdRef,
	archiveItem,
	consumePasteIntent,
	handleAddedCards,
	handleRemovedCards,
	setWhiteboardDeletePending,
	queueFrameUpdate,
	queueDrawingSave,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	hydratingRef: MutableRefObject<boolean>;
	itemIdByShapeIdRef: MutableRefObject<Map<string, Id<"boardItems">>>;
	archiveItem: (args: {
		itemId: Id<"boardItems">;
		deleteCards: boolean;
	}) => Promise<unknown>;
	consumePasteIntent: () => boolean;
	handleAddedCards: (cards: MarkdownCardShape[], isPaste: boolean) => void;
	handleRemovedCards: (shapeIds: string[]) => void;
	setWhiteboardDeletePending: Dispatch<
		SetStateAction<{
			itemId: Id<"boardItems">;
			shape: ManagedWhiteboardShape;
		} | null>
	>;
	queueFrameUpdate: (itemId: Id<"boardItems">, frame: WhiteboardFrame) => void;
	queueDrawingSave: (delta: CanvasRecordDelta) => void;
}) {
	useEffect(() => {
		if (!editor) return;

		const removeListener = editor.store.listen(
			({ changes }) => {
				if (hydratingRef.current) return;
				const isPaste = consumePasteIntent();
				const untrackedCards: MarkdownCardShape[] = [];

				for (const record of Object.values(changes.added)) {
					if (!isManagedWhiteboardShape(record)) continue;
					if (record.type !== "markdown-card") continue; // cards only
					if (itemIdByShapeIdRef.current.has(record.id)) continue; // already tracked; not a restore/adopt

					if (!whiteboardId) {
						// Root board can't host cards; drop the orphan so it doesn't
						// ghost on screen until the next reload strips it.
						editor.deleteShapes([record.id]);
						continue;
					}

					untrackedCards.push(record);
				}
				handleAddedCards(untrackedCards, isPaste);
				handleRemovedCards(
					Object.values(changes.removed)
						.filter(
							(shape): shape is MarkdownCardShape =>
								isManagedWhiteboardShape(shape) &&
								shape.type === "markdown-card",
						)
						.map((shape) => shape.id),
				);

				for (const shape of Object.values(changes.removed)) {
					if (!isManagedWhiteboardShape(shape)) continue;
					forgetMeasuredCardHeight(shape.id);

					const itemId = itemIdByShapeIdRef.current.get(shape.id);
					if (itemId) {
						if (shape.type === "subwhiteboard-link") {
							setWhiteboardDeletePending({ itemId, shape });
						} else {
							// Plain delete detaches the card from this board; the card itself
							// survives (Ctrl+Delete is the global delete path).
							void archiveItem({ itemId, deleteCards: false });
						}
					}
				}

				let zIndexByShapeId: Map<TLShapeId, number> | null = null;

				for (const [previous, changed] of Object.values(changes.updated)) {
					if (
						!isManagedWhiteboardShape(previous) ||
						!isManagedWhiteboardShape(changed)
					) {
						continue;
					}
					if (!hasManagedShapeFrameChanged(previous, changed)) continue;

					const itemId = itemIdByShapeIdRef.current.get(changed.id);
					if (!itemId) continue;

					zIndexByShapeId ??= new Map<TLShapeId, number>(
						editor
							.getCurrentPageShapesSorted()
							.map((shape, index) => [shape.id, index]),
					);

					queueFrameUpdate(itemId, {
						x: changed.x,
						y: changed.y,
						w: changed.props.w,
						h: changed.props.h,
						rotation: changed.rotation,
						zIndex: zIndexByShapeId.get(changed.id) ?? 0,
					});
				}

				if (hasPersistableDrawingChange(changes)) {
					const persistable = (record: unknown) =>
						!isManagedWhiteboardShape(record);
					if (!whiteboardId) {
						const rootRecordIds = Object.values(changes.added)
							.filter(persistable)
							.flatMap((record) =>
								record &&
								typeof record === "object" &&
								"id" in record &&
								typeof record.id === "string"
									? [record.id]
									: [],
							);
						if (rootRecordIds.length) {
							hydratingRef.current = true;
							editor.store.remove(rootRecordIds as never[]);
							window.setTimeout(() => {
								hydratingRef.current = false;
							}, 0);
						}
						return;
					}
					queueDrawingSave({
						added: Object.values(changes.added).filter(persistable),
						updated: Object.values(changes.updated)
							.map(([, record]) => record)
							.filter(persistable),
						removed: Object.values(changes.removed)
							.filter(persistable)
							.map((record) => record.id),
					});
				}
			},
			{ source: "user", scope: "document" },
		);

		return () => {
			removeListener();
		};
	}, [
		archiveItem,
		consumePasteIntent,
		editor,
		hydratingRef,
		handleAddedCards,
		handleRemovedCards,
		itemIdByShapeIdRef,
		queueDrawingSave,
		queueFrameUpdate,
		setWhiteboardDeletePending,
		whiteboardId,
	]);
}
