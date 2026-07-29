import { useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import type { BoardItemResult } from "../whiteboard-canvas-helpers";

export function useCameraReset({
	editor,
	items,
	itemQueryStatus,
	loadedDrawingKey,
	whiteboardKey,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	itemQueryStatus: string;
	loadedDrawingKey: string | null;
	whiteboardKey: string;
}) {
	const pendingCameraResetRef = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: whiteboardKey intentionally arms one reset per board
	useEffect(() => {
		pendingCameraResetRef.current = true;
	}, [whiteboardKey]);

	// After switching boards, reset the camera once the new board's first page
	// and drawing have both hydrated. The item query can resolve before the
	// drawing snapshot; zooming earlier would frame the previous board's shapes.
	useEffect(() => {
		if (!editor || !pendingCameraResetRef.current) return;
		if (itemQueryStatus === "LoadingFirstPage") return;
		if (loadedDrawingKey !== whiteboardKey) return;

		pendingCameraResetRef.current = false;
		if (items.length > 0) {
			editor.zoomToFit();
		} else {
			editor.setCamera({ x: 0, y: 0, z: 1 });
		}
	}, [
		editor,
		items,
		itemQueryStatus,
		loadedDrawingKey,
		whiteboardKey,
	]);

	return { pendingCameraResetRef };
}
