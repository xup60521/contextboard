import type { useNavigate } from "@tanstack/react-router";
import { useEffect, type MutableRefObject } from "react";
import type { Editor, TLEventInfo, TLShapeId, VecLike } from "tldraw";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	getWhiteboardDoubleClickShape,
	isMarkdownCardShape,
	isPointInCurrentSelection,
	openSubwhiteboardShape,
} from "../whiteboard-canvas-helpers";

export function useCanvasEvents({
	editor,
	whiteboardId,
	createCardAt,
	createSubwhiteboardAt,
	contextMenuPointRef,
	prioritizeCardContent,
	pendingEditShapeIdRef,
	navigate,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	createCardAt: (point: VecLike) => void;
	createSubwhiteboardAt: (point: VecLike) => void;
	contextMenuPointRef: MutableRefObject<VecLike | null>;
	prioritizeCardContent: (shapeId: TLShapeId, cardId: Id<"cards">) => void;
	pendingEditShapeIdRef: MutableRefObject<TLShapeId | null>;
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
				if (
					isMarkdownCardShape(info.shape) &&
					info.shape.props.cardId &&
					!info.shape.props.contentLoaded
				) {
					pendingEditShapeIdRef.current = info.shape.id;
					prioritizeCardContent(
						info.shape.id,
						info.shape.props.cardId as Id<"cards">,
					);
					return;
				}

				openSubwhiteboardShape(navigate, info.shape);
				return;
			}

			if (info.target !== "canvas") return;

			const hitShape = getWhiteboardDoubleClickShape(editor, point);

			if (hitShape) {
				if (
					isMarkdownCardShape(hitShape) &&
					hitShape.props.cardId &&
					!hitShape.props.contentLoaded
				) {
					pendingEditShapeIdRef.current = hitShape.id;
					prioritizeCardContent(
						hitShape.id,
						hitShape.props.cardId as Id<"cards">,
					);
					return;
				}

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
		pendingEditShapeIdRef,
		prioritizeCardContent,
		whiteboardId,
	]);
}
