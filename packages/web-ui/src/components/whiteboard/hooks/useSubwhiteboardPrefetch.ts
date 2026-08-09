import { useEffect } from "react";
import { type Editor, react as tldrawReact } from "tldraw";
import { isSubwhiteboardLinkShape } from "../whiteboard-canvas-helpers";

/**
 * Warms a sub-whiteboard's data as soon as the user shows intent.
 *
 * Sub-whiteboard tiles are the main way boards are entered — double-click, the
 * context menu, or Enter on the selection — and all three commit instantly with
 * no chance to load anything first. Hovering or selecting the tile happens
 * before every one of them, which is enough lead time to have the board's items
 * and snapshot already in memory when the navigation lands.
 */
export function useSubwhiteboardPrefetch({
	editor,
	prefetchWhiteboard,
}: {
	editor: Editor | null;
	prefetchWhiteboard: (whiteboardId: string | null) => void;
}) {
	useEffect(() => {
		if (!editor) return;

		return tldrawReact("prefetch hovered sub-whiteboard", () => {
			const candidates = [
				editor.getHoveredShapeId(),
				...editor.getSelectedShapeIds(),
			];
			for (const shapeId of candidates) {
				if (!shapeId) continue;
				const shape = editor.getShape(shapeId);
				if (!shape || !isSubwhiteboardLinkShape(shape)) continue;
				const childWhiteboardId = shape.props.childWhiteboardId;
				if (childWhiteboardId) prefetchWhiteboard(childWhiteboardId);
			}
		});
	}, [editor, prefetchWhiteboard]);
}
