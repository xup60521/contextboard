import type { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { Editor, TLShapeId } from "tldraw";
import type { BoardItemResult } from "../whiteboard-canvas-helpers";

export function useFocusShape({
	editor,
	focusShapeId,
	items,
	loadedDrawingKey,
	whiteboardKey,
	pendingCameraResetRef,
	navigate,
}: {
	editor: Editor | null;
	focusShapeId: string | null;
	items: BoardItemResult[];
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	pendingCameraResetRef: MutableRefObject<boolean>;
	navigate: ReturnType<typeof useNavigate>;
}) {
	const handledFocusRef = useRef<string | null>(null);

	// Navigate & focus: when a `focus` shape id is present (set by the command
	// palette via the route's search param), select and zoom to that shape once
	// the board has hydrated, then clear the param so re-selecting re-triggers.
	// biome-ignore lint/correctness/useExhaustiveDependencies: items re-runs after hydration creates the focused shape
	useEffect(() => {
		if (!focusShapeId) {
			handledFocusRef.current = null;
			return;
		}
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		if (handledFocusRef.current === focusShapeId) return;

		const shapeId = focusShapeId as TLShapeId;
		if (!editor.getShape(shapeId)) return; // shape not hydrated yet; will re-run

		handledFocusRef.current = focusShapeId;
		pendingCameraResetRef.current = false;
		editor.select(shapeId);
		const bounds = editor.getShapePageBounds(shapeId);
		if (bounds) {
			editor.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 128 });
		}

		void navigate({
			to: ".",
			replace: true,
			search: (prev: { focus?: string }) => ({ ...prev, focus: undefined }),
		});
	}, [editor, focusShapeId, items, loadedDrawingKey, navigate, whiteboardKey]);
}
