import type { useNavigate } from "@tanstack/react-router";
import { useEffect, type MutableRefObject } from "react";
import type { Editor, TLEventInfo, VecLike } from "tldraw";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	getWhiteboardDoubleClickShape,
	isPointInCurrentSelection,
	openSubwhiteboardShape,
} from "../whiteboard-canvas-helpers";

export function useCanvasEvents({
	editor,
	whiteboardId,
	createCardAt,
	createSubwhiteboardAt,
	contextMenuPointRef,
	navigate,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	createCardAt: (point: VecLike) => void;
	createSubwhiteboardAt: (point: VecLike) => void;
	contextMenuPointRef: MutableRefObject<VecLike | null>;
	navigate: ReturnType<typeof useNavigate>;
}) {
	// Canvas interactions (right-click point capture, double-click to open a
	// sub-whiteboard or create an item). Registered in an effect rather than
	// `onMount` so the latest `whiteboardId`/create callbacks are used after
	// navigating between boards on the now-persistent editor.
	useEffect(() => {
		if (!editor) return;

		const handleEvent = (info: TLEventInfo) => {
			if (info.type === "pointer" && info.name === "right_click") {
				const point = editor.inputs.currentPagePoint;
				contextMenuPointRef.current = { x: point.x, y: point.y };
			}

			if (
				info.type !== "click" ||
				info.name !== "double_click" ||
				info.phase !== "up"
			) {
				return;
			}

			const point = editor.inputs.currentPagePoint;

			if (info.target === "shape") {
				openSubwhiteboardShape(navigate, info.shape);
				return;
			}

			if (info.target !== "canvas") return;

			const hitShape = getWhiteboardDoubleClickShape(editor, point);

			if (hitShape) {
				openSubwhiteboardShape(navigate, hitShape);
				return;
			}

			if (isPointInCurrentSelection(editor, point)) {
				return;
			}

			if (whiteboardId) {
				createCardAt(point);
			} else {
				createSubwhiteboardAt(point);
			}
		};

		editor.on("event", handleEvent);

		return () => {
			editor.off("event", handleEvent);
		};
	}, [
		contextMenuPointRef,
		createCardAt,
		createSubwhiteboardAt,
		editor,
		navigate,
		whiteboardId,
	]);
}
