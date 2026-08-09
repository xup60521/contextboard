import { type MutableRefObject, useEffect, useRef } from "react";
import { type Editor, react as tldrawReact } from "tldraw";
import {
	getCameraStorageKey,
	type StoredCamera,
	writeCamera,
} from "../camera-store";

const CAMERA_WRITE_DEBOUNCE_MS = 300;

/**
 * Remembers where each board was last viewed.
 *
 * Writes are debounced because a single pan emits a camera value per pointer
 * frame, and are suppressed until the board's drawing has hydrated *and* the
 * camera has been claimed for this board. Until then the editor still holds the
 * previous board's camera, which must never be written under this board's key.
 */
export function useCameraPersistence({
	editor,
	workspaceId,
	whiteboardKey,
	loadedDrawingKey,
	pendingCameraResetRef,
	enabled = true,
}: {
	editor: Editor | null;
	workspaceId: string | null | undefined;
	whiteboardKey: string;
	loadedDrawingKey: string | null;
	/** True until `useCameraReset` or `useFocusShape` has positioned this board. */
	pendingCameraResetRef: MutableRefObject<boolean>;
	enabled?: boolean;
}) {
	const pendingCameraRef = useRef<StoredCamera | null>(null);
	const timerRef = useRef<number | null>(null);

	useEffect(() => {
		if (!enabled || !editor || loadedDrawingKey !== whiteboardKey) return;

		const storageKey = getCameraStorageKey(workspaceId, whiteboardKey);

		const flush = () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			const pending = pendingCameraRef.current;
			pendingCameraRef.current = null;
			if (pending) writeCamera(storageKey, pending);
		};

		const stopListening = tldrawReact("persist whiteboard camera", () => {
			const camera = editor.getCamera();
			if (pendingCameraResetRef.current) return;
			pendingCameraRef.current = { x: camera.x, y: camera.y, z: camera.z };
			if (timerRef.current !== null) return;
			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				const pending = pendingCameraRef.current;
				pendingCameraRef.current = null;
				if (pending) writeCamera(storageKey, pending);
			}, CAMERA_WRITE_DEBOUNCE_MS);
		});

		// A closing tab or a backgrounded app never gets the cleanup below.
		const handleHide = () => flush();
		window.addEventListener("pagehide", handleHide);
		document.addEventListener("visibilitychange", handleHide);

		return () => {
			stopListening();
			window.removeEventListener("pagehide", handleHide);
			document.removeEventListener("visibilitychange", handleHide);
			flush();
		};
	}, [
		editor,
		enabled,
		loadedDrawingKey,
		pendingCameraResetRef,
		whiteboardKey,
		workspaceId,
	]);
}
