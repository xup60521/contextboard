import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useEffect,
} from "react";
import type { Editor, TLShapeId, TLStoreSnapshot } from "tldraw";
import type { Id } from "#/integrations/local/types";
import type { WhiteboardFrame } from "../frame-sync";
import { filterSnapshotForPersistence } from "../tldraw-persistence";
import {
	hasManagedShapeFrameChanged,
	hasPersistableDrawingChange,
	isManagedWhiteboardShape,
	type ManagedWhiteboardShape,
} from "../whiteboard-canvas-helpers";

export function useStoreListener({
	editor,
	whiteboardId,
	hydratingRef,
	itemIdByShapeIdRef,
	archiveItem,
	restoreOrAdoptCardItem,
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
	restoreOrAdoptCardItem: (args: {
		whiteboardId: Id<"whiteboards"> | null;
		shapeId: string;
		sourceCardId?: string;
		content?: string;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
	}) => Promise<unknown>;
	setWhiteboardDeletePending: Dispatch<
		SetStateAction<{
			itemId: Id<"boardItems">;
			shape: ManagedWhiteboardShape;
		} | null>
	>;
	queueFrameUpdate: (itemId: Id<"boardItems">, frame: WhiteboardFrame) => void;
	queueDrawingSave: (snapshot: TLStoreSnapshot) => void;
}) {
	useEffect(() => {
		if (!editor) return;

		const removeListener = editor.store.listen(
			({ changes }) => {
				if (hydratingRef.current) return;

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

					void restoreOrAdoptCardItem({
						whiteboardId,
						shapeId: record.id,
						sourceCardId: record.props.cardId,
						content: record.props.content,
						x: record.x,
						y: record.y,
						w: record.props.w,
						h: record.props.h,
						rotation: record.rotation,
					});
				}

				for (const shape of Object.values(changes.removed)) {
					if (!isManagedWhiteboardShape(shape)) continue;

					const itemId = itemIdByShapeIdRef.current.get(shape.id);
					if (itemId) {
						if (shape.type === "subwhiteboard-link") {
							setWhiteboardDeletePending({ itemId, shape });
						} else {
							void archiveItem({ itemId, deleteCards: true });
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
					queueDrawingSave(
						filterSnapshotForPersistence(
							editor.store.getStoreSnapshot("document"),
						),
					);
				}
			},
			{ source: "user", scope: "document" },
		);

		return () => {
			removeListener();
		};
	}, [
		archiveItem,
		editor,
		hydratingRef,
		itemIdByShapeIdRef,
		queueDrawingSave,
		queueFrameUpdate,
		restoreOrAdoptCardItem,
		setWhiteboardDeletePending,
		whiteboardId,
	]);
}
