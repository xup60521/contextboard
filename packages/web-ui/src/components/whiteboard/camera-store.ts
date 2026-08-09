/**
 * Device-local camera memory for whiteboards.
 *
 * The camera is view state, not document state: tldraw keeps `camera` and
 * `instance_page_state` in the session scope and canvas persistence only ever
 * writes the document scope, so nothing here belongs in the repository or the
 * sync change log. Two devices looking at the same board should keep their own
 * viewports. `localStorage` is the same channel the theme and sidebar
 * preferences already use, and Tauri's webview provides it, so the desktop app
 * inherits this without touching `WorkspaceRepository`.
 */

const STORAGE_KEY = "contextboard:camera:v1";
const MAX_ENTRIES = 200;

export type StoredCamera = { x: number; y: number; z: number };
type StoredEntry = StoredCamera & { at: number };
type CameraMap = Record<string, StoredEntry>;

export const ROOT_WHITEBOARD_CAMERA_KEY = "__root__";

export function getCameraStorageKey(
	workspaceId: string | null | undefined,
	whiteboardKey: string,
): string {
	return `${workspaceId ?? "__workspace__"}:${whiteboardKey}`;
}

function getStorage(): Storage | null {
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		// Storage can be disabled entirely (private mode, blocked cookies).
		return null;
	}
}

function readMap(): CameraMap {
	const storage = getStorage();
	if (!storage) return {};
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as CameraMap;
	} catch {
		return {};
	}
}

function isUsableCamera(value: unknown): value is StoredEntry {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<StoredEntry>;
	return (
		Number.isFinite(candidate.x) &&
		Number.isFinite(candidate.y) &&
		Number.isFinite(candidate.z) &&
		(candidate.z as number) > 0
	);
}

export function readCamera(key: string): StoredCamera | null {
	const entry = readMap()[key];
	if (!isUsableCamera(entry)) return null;
	return { x: entry.x, y: entry.y, z: entry.z };
}

export function writeCamera(key: string, camera: StoredCamera): void {
	const storage = getStorage();
	if (!storage) return;
	if (!isUsableCamera(camera)) return;

	try {
		const map = readMap();
		map[key] = { x: camera.x, y: camera.y, z: camera.z, at: Date.now() };

		const keys = Object.keys(map);
		if (keys.length > MAX_ENTRIES) {
			// Drop the least recently written boards first.
			const ordered = keys.sort(
				(a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0),
			);
			for (const staleKey of ordered.slice(0, keys.length - MAX_ENTRIES)) {
				delete map[staleKey];
			}
		}

		storage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		// A full or unavailable quota must never break the canvas.
	}
}

export function clearCameraStore(): void {
	try {
		getStorage()?.removeItem(STORAGE_KEY);
	} catch {
		// Nothing to do; the store is best-effort.
	}
}
