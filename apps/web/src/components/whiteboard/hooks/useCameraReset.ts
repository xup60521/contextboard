import { useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import type { BoardItemResult } from "../whiteboard-canvas-helpers";

export function useCameraReset({
	editor,
	items,
	itemQueryStatus,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	itemQueryStatus: string;
}) {
	const pendingCameraResetRef = useRef(true);

	// After switching boards, reset the camera once the new board's first page
	// has loaded so it opens at a sensible viewport instead of inheriting the
	// previous board's pan/zoom.
	useEffect(() => {
		if (!editor || !pendingCameraResetRef.current) return;
		if (itemQueryStatus === "LoadingFirstPage") return;

		pendingCameraResetRef.current = false;
		if (items.length > 0) {
			editor.zoomToFit();
		} else {
			editor.setCamera({ x: 0, y: 0, z: 1 });
		}
	}, [editor, items, itemQueryStatus]);

	return { pendingCameraResetRef };
}
