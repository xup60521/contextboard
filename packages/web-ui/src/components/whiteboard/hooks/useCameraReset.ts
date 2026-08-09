import { useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import {
	getCameraStorageKey,
	readCamera,
	writeCamera,
} from "../camera-store";
import type { BoardItemResult } from "../whiteboard-canvas-helpers";

/**
 * How long a first-visit `zoomToFit` keeps re-fitting while the board settles.
 *
 * Cards are created at an *estimated* height and corrected once by
 * `useMarkdownCardAutoHeight` after their content hydrates and renders. A fit
 * performed before those corrections frames the wrong bounds, so the first fit
 * is repeated while the content bounds are still moving.
 */
const SETTLE_WINDOW_MS = 500;

function boundsSignature(editor: Editor): string | null {
	const bounds = editor.getCurrentPageBounds?.();
	if (!bounds) return null;
	return `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(
		bounds.w,
	)}:${Math.round(bounds.h)}`;
}

/**
 * The container may still be zero-sized on the commit where hydration finishes.
 * Framing against that viewport produces a nonsense zoom, so the one shot is
 * held rather than spent. A missing method (test doubles) counts as ready.
 */
function hasUsableViewport(editor: Editor): boolean {
	const bounds = editor.getViewportScreenBounds?.();
	if (!bounds) return true;
	return bounds.w > 0 && bounds.h > 0;
}

export function useCameraReset({
	editor,
	items,
	itemQueryStatus,
	loadedDrawingKey,
	whiteboardKey,
	workspaceId,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	itemQueryStatus: string;
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	workspaceId?: string | null;
}) {
	const pendingCameraResetRef = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: whiteboardKey intentionally arms one reset per board
	useEffect(() => {
		pendingCameraResetRef.current = true;
	}, [whiteboardKey]);

	// After switching boards, restore the camera once the new board's first page
	// and drawing have both hydrated. The item query can resolve before the
	// drawing snapshot; acting earlier would frame the previous board's shapes.
	useEffect(() => {
		if (!editor || !pendingCameraResetRef.current) return;
		if (itemQueryStatus === "LoadingFirstPage") return;
		if (loadedDrawingKey !== whiteboardKey) return;

		let cancelled = false;
		let frame: number | null = null;
		let settleTimer: number | null = null;

		const storageKey = getCameraStorageKey(workspaceId, whiteboardKey);

		const cancel = () => {
			cancelled = true;
			if (frame !== null && typeof cancelAnimationFrame === "function") {
				cancelAnimationFrame(frame);
				frame = null;
			}
			if (settleTimer !== null) {
				window.clearTimeout(settleTimer);
				settleTimer = null;
			}
		};

		const schedule = (run: () => void) => {
			if (typeof requestAnimationFrame !== "function") {
				run();
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = null;
				if (!cancelled) run();
			});
		};

		// Any real input means the user has taken the camera; stop correcting it.
		const stopOnUserInput = () => cancel();
		const inputEvents = ["pointerdown", "wheel", "keydown"] as const;

		const cameraSignature = () => {
			const camera = editor.getCamera?.();
			return camera ? `${camera.x}:${camera.y}:${camera.z}` : null;
		};

		const settle = () => {
			let lastBounds = boundsSignature(editor);
			// Anything that moves the camera out from under us — `useFocusShape`'s
			// zoom-to-bounds, a right-drag pan, a programmatic jump — ends the
			// correction pass. This needs no coordination with those callers.
			let ownCamera = cameraSignature();
			const deadline = Date.now() + SETTLE_WINDOW_MS;

			const step = () => {
				if (cancelled) return;
				if (cameraSignature() !== ownCamera) return;

				const bounds = boundsSignature(editor);
				if (bounds !== lastBounds) {
					lastBounds = bounds;
					editor.zoomToFit();
					ownCamera = cameraSignature();
				}
				if (Date.now() >= deadline) {
					const camera = editor.getCamera?.();
					if (camera) writeCamera(storageKey, camera);
					return;
				}
				schedule(step);
			};

			schedule(step);
		};

		const apply = () => {
			if (cancelled) return;
			if (!hasUsableViewport(editor)) {
				// Do not consume the one shot: retry once the container is laid out.
				schedule(apply);
				return;
			}

			pendingCameraResetRef.current = false;

			const stored = readCamera(storageKey);
			if (stored) {
				// An exact camera does not depend on card geometry having settled,
				// which is why every visit after the first needs no correction pass.
				editor.setCamera(stored);
				return;
			}

			if (items.length > 0) {
				editor.zoomToFit();
				for (const type of inputEvents) {
					window.addEventListener(type, stopOnUserInput, {
						capture: true,
						once: true,
					});
				}
				settle();
			} else {
				editor.setCamera({ x: 0, y: 0, z: 1 });
			}
		};

		apply();

		return () => {
			cancel();
			for (const type of inputEvents) {
				window.removeEventListener(type, stopOnUserInput, { capture: true });
			}
		};
	}, [
		editor,
		items,
		itemQueryStatus,
		loadedDrawingKey,
		whiteboardKey,
		workspaceId,
	]);

	return { pendingCameraResetRef };
}
