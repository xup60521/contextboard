// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	clearCameraStore,
	getCameraStorageKey,
	writeCamera,
} from "../camera-store";
import { useCameraReset } from "./useCameraReset";

function item(id: string) {
	return {
		_id: id,
		shapeId: `shape:${id}`,
	} as never;
}

/** A viewport that has been laid out, plus the camera surface the hook reads. */
function createEditor(overrides: Record<string, unknown> = {}) {
	return {
		zoomToFit: vi.fn(),
		setCamera: vi.fn(),
		getCamera: vi.fn(() => ({ x: 0, y: 0, z: 1 })),
		getCurrentPageBounds: vi.fn(() => null),
		getViewportScreenBounds: vi.fn(() => ({ x: 0, y: 0, w: 1024, h: 768 })),
		...overrides,
	};
}

describe("useCameraReset", () => {
	beforeEach(() => {
		clearCameraStore();
	});

	test("waits for the active board drawing before framing its shapes", () => {
		const editor = createEditor();
		const { rerender } = renderHook(
			({
				whiteboardKey,
				loadedDrawingKey,
				items,
			}: {
				whiteboardKey: string;
				loadedDrawingKey: string | null;
				items: never[];
			}) =>
				useCameraReset({
					editor: editor as never,
					items,
					itemQueryStatus: "Exhausted",
					loadedDrawingKey,
					whiteboardKey,
				}),
			{
				initialProps: {
					whiteboardKey: "A",
					loadedDrawingKey: "A",
					items: [item("a")],
				},
			},
		);

		expect(editor.zoomToFit).toHaveBeenCalledTimes(1);

		// Board B's item query can resolve while drawing A is still in the editor.
		rerender({
			whiteboardKey: "B",
			loadedDrawingKey: "A",
			items: [item("b")],
		});
		expect(editor.zoomToFit).toHaveBeenCalledTimes(1);

		// Only frame the viewport after drawing B and its managed shapes hydrate.
		rerender({
			whiteboardKey: "B",
			loadedDrawingKey: "B",
			items: [item("b")],
		});
		expect(editor.zoomToFit).toHaveBeenCalledTimes(2);
	});

	test("resets an empty hydrated board to the default camera", () => {
		const editor = createEditor();
		renderHook(() =>
			useCameraReset({
				editor: editor as never,
				items: [],
				itemQueryStatus: "Exhausted",
				loadedDrawingKey: "empty",
				whiteboardKey: "empty",
			}),
		);

		expect(editor.zoomToFit).not.toHaveBeenCalled();
		expect(editor.setCamera).toHaveBeenCalledWith({ x: 0, y: 0, z: 1 });
	});

	test("restores a stored camera verbatim instead of refitting", () => {
		const stored = { x: -420, y: 137, z: 0.35 };
		writeCamera(getCameraStorageKey("workspace-1", "board"), stored);
		const editor = createEditor();

		renderHook(() =>
			useCameraReset({
				editor: editor as never,
				items: [item("a")],
				itemQueryStatus: "Exhausted",
				loadedDrawingKey: "board",
				whiteboardKey: "board",
				workspaceId: "workspace-1",
			}),
		);

		expect(editor.setCamera).toHaveBeenCalledWith(stored);
		expect(editor.zoomToFit).not.toHaveBeenCalled();
	});

	test("ignores a camera stored for a different workspace", () => {
		writeCamera(getCameraStorageKey("workspace-1", "board"), {
			x: 1,
			y: 2,
			z: 3,
		});
		const editor = createEditor();

		renderHook(() =>
			useCameraReset({
				editor: editor as never,
				items: [item("a")],
				itemQueryStatus: "Exhausted",
				loadedDrawingKey: "board",
				whiteboardKey: "board",
				workspaceId: "workspace-2",
			}),
		);

		expect(editor.zoomToFit).toHaveBeenCalledTimes(1);
	});

	test("holds the one shot while the container has no size", () => {
		const bounds = { x: 0, y: 0, w: 0, h: 0 };
		const editor = createEditor({
			getViewportScreenBounds: vi.fn(() => bounds),
		});

		const { rerender } = renderHook(
			({ items }: { items: never[] }) =>
				useCameraReset({
					editor: editor as never,
					items,
					itemQueryStatus: "Exhausted",
					loadedDrawingKey: "board",
					whiteboardKey: "board",
				}),
			{ initialProps: { items: [item("a")] } },
		);

		expect(editor.zoomToFit).not.toHaveBeenCalled();
		expect(editor.setCamera).not.toHaveBeenCalled();

		// The shot was not consumed, so the next commit still frames the board.
		bounds.w = 1024;
		bounds.h = 768;
		rerender({ items: [item("a"), item("b")] });

		expect(editor.zoomToFit).toHaveBeenCalledTimes(1);
	});

	test("does not act once the focus handler has claimed the camera", () => {
		const editor = createEditor();
		const { result, rerender } = renderHook(
			({ loadedDrawingKey }: { loadedDrawingKey: string | null }) =>
				useCameraReset({
					editor: editor as never,
					items: [item("a")],
					itemQueryStatus: "Exhausted",
					loadedDrawingKey,
					whiteboardKey: "board",
				}),
			{ initialProps: { loadedDrawingKey: null } },
		);

		// `useFocusShape` clears the flag when it zooms to the focused shape.
		result.current.pendingCameraResetRef.current = false;
		rerender({ loadedDrawingKey: "board" });

		expect(editor.zoomToFit).not.toHaveBeenCalled();
		expect(editor.setCamera).not.toHaveBeenCalled();
	});
});
