import { useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import {
	getRightDragPanNextCamera,
	hasExceededRightDragPanThreshold,
	syncRightDragPanPointer,
	type RightDragPanState,
} from "../whiteboard-canvas-helpers";

const SUPPRESS_CONTEXT_MENU_AFTER_RIGHT_DRAG_MS = 250;

export function useRightDragPan({ editor }: { editor: Editor | null }) {
	const rightDragPanStateRef = useRef<RightDragPanState | null>(null);
	const suppressContextMenuUntilRef = useRef(0);

	useEffect(() => {
		if (!editor) return;

		const container = editor.getContainer();
		const ownerDocument = container.ownerDocument;
		const ownerWindow = ownerDocument.defaultView;

		const finishRightDragPan = (pointerId?: number) => {
			const state = rightDragPanStateRef.current;
			if (!state) return;
			if (pointerId !== undefined && state.pointerId !== pointerId) return;

			if (state.dragging) {
				suppressContextMenuUntilRef.current =
					Date.now() + SUPPRESS_CONTEXT_MENU_AFTER_RIGHT_DRAG_MS;
				editor.setCursor(state.previousCursor);
			}

			rightDragPanStateRef.current = null;
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== 2) return;
			if (
				!(event.target instanceof Node) ||
				!container.contains(event.target)
			) {
				return;
			}

			const { type, rotation } = editor.getInstanceState().cursor;
			rightDragPanStateRef.current = {
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				lastClientX: event.clientX,
				lastClientY: event.clientY,
				dragging: false,
				previousCursor: { type, rotation },
			};
		};

		const handlePointerMove = (event: PointerEvent) => {
			const state = rightDragPanStateRef.current;
			if (!state || state.pointerId !== event.pointerId) return;

			if (
				!state.dragging &&
				!hasExceededRightDragPanThreshold({
					startClientX: state.startClientX,
					startClientY: state.startClientY,
					currentClientX: event.clientX,
					currentClientY: event.clientY,
				})
			) {
				return;
			}

			if (!state.dragging) {
				state.dragging = true;
				editor.stopCameraAnimation();
				editor.menus.clearOpenMenus();
				editor.setCursor({ type: "grabbing", rotation: 0 });
			}

			const deltaX = event.clientX - state.lastClientX;
			const deltaY = event.clientY - state.lastClientY;
			state.lastClientX = event.clientX;
			state.lastClientY = event.clientY;

			if (deltaX === 0 && deltaY === 0) return;

			syncRightDragPanPointer(editor, {
				x: event.clientX,
				y: event.clientY,
				z: event.pressure,
			});

			editor.setCamera(
				getRightDragPanNextCamera(editor.getCamera(), {
					x: deltaX,
					y: deltaY,
				}),
				{ immediate: true },
			);
			event.preventDefault();
			event.stopPropagation();
		};

		const handlePointerUp = (event: PointerEvent) => {
			finishRightDragPan(event.pointerId);
		};

		const handlePointerCancel = (event: PointerEvent) => {
			finishRightDragPan(event.pointerId);
		};

		const handleContextMenu = (event: MouseEvent) => {
			const state = rightDragPanStateRef.current;
			const shouldSuppress =
				(state?.dragging ?? false) ||
				Date.now() < suppressContextMenuUntilRef.current;

			if (!shouldSuppress) return;
			if (
				!(event.target instanceof Node) ||
				!container.contains(event.target)
			) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
		};

		const handleWindowBlur = () => {
			finishRightDragPan();
		};

		container.addEventListener("pointerdown", handlePointerDown, true);
		ownerDocument.addEventListener("pointermove", handlePointerMove, true);
		ownerDocument.addEventListener("pointerup", handlePointerUp, true);
		ownerDocument.addEventListener("pointercancel", handlePointerCancel, true);
		container.addEventListener("contextmenu", handleContextMenu, true);
		ownerWindow?.addEventListener("blur", handleWindowBlur);

		return () => {
			container.removeEventListener("pointerdown", handlePointerDown, true);
			ownerDocument.removeEventListener("pointermove", handlePointerMove, true);
			ownerDocument.removeEventListener("pointerup", handlePointerUp, true);
			ownerDocument.removeEventListener(
				"pointercancel",
				handlePointerCancel,
				true,
			);
			container.removeEventListener("contextmenu", handleContextMenu, true);
			ownerWindow?.removeEventListener("blur", handleWindowBlur);
			finishRightDragPan();
		};
	}, [editor]);
}
