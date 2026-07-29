// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useCameraReset } from "./useCameraReset";

function item(id: string) {
	return {
		_id: id,
		shapeId: `shape:${id}`,
	} as never;
}

describe("useCameraReset", () => {
	test("waits for the active board drawing before framing its shapes", () => {
		const editor = {
			zoomToFit: vi.fn(),
			setCamera: vi.fn(),
		};
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
		const editor = {
			zoomToFit: vi.fn(),
			setCamera: vi.fn(),
		};
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
});
