// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { TLEventInfo } from "tldraw";
import { describe, expect, test, vi } from "vitest";
import { useCanvasPersistenceInteraction } from "./useCanvasPersistenceInteraction";

function createEditor() {
	let listener: ((info: TLEventInfo) => void) | null = null;
	return {
		editor: {
			on: vi.fn((_event: "event", next: (info: TLEventInfo) => void) => {
				listener = next;
			}),
			off: vi.fn(() => {
				listener = null;
			}),
		},
		emit(info: TLEventInfo) {
			listener?.(info);
		},
	};
}

function pointer(name: "pointer_down" | "pointer_up", pointerId: number) {
	return {
		type: "pointer",
		name,
		pointerId,
		target: "canvas",
		point: { x: 0, y: 0 },
		button: 0,
		isPen: false,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		accelKey: false,
	} as TLEventInfo;
}

describe("useCanvasPersistenceInteraction", () => {
	test("flushes only after the final active pointer is released", async () => {
		const harness = createEditor();
		const interactionActiveRef = { current: false };
		const pauseFramePersistence = vi.fn();
		const flushFrameUpdates = vi.fn();
		const pauseDrawingPersistence = vi.fn();
		const flushDrawingSave = vi.fn().mockResolvedValue(undefined);

		renderHook(() =>
			useCanvasPersistenceInteraction({
				editor: harness.editor as never,
				interactionActiveRef,
				pauseFramePersistence,
				flushFrameUpdates,
				pauseDrawingPersistence,
				flushDrawingSave,
			}),
		);

		act(() => {
			harness.emit(pointer("pointer_down", 1));
			harness.emit(pointer("pointer_down", 2));
			harness.emit(pointer("pointer_up", 1));
		});
		await Promise.resolve();

		expect(interactionActiveRef.current).toBe(true);
		expect(flushFrameUpdates).not.toHaveBeenCalled();
		expect(flushDrawingSave).not.toHaveBeenCalled();

		act(() => harness.emit(pointer("pointer_up", 2)));
		await Promise.resolve();

		expect(interactionActiveRef.current).toBe(false);
		expect(pauseFramePersistence).toHaveBeenCalledTimes(1);
		expect(pauseDrawingPersistence).toHaveBeenCalledTimes(1);
		expect(flushFrameUpdates).toHaveBeenCalledTimes(1);
		expect(flushDrawingSave).toHaveBeenCalledTimes(1);
	});

	test("flushes pending persistence when the editor interrupts an interaction", async () => {
		const harness = createEditor();
		const interactionActiveRef = { current: false };
		const flushFrameUpdates = vi.fn();
		const flushDrawingSave = vi.fn().mockResolvedValue(undefined);

		renderHook(() =>
			useCanvasPersistenceInteraction({
				editor: harness.editor as never,
				interactionActiveRef,
				pauseFramePersistence: vi.fn(),
				flushFrameUpdates,
				pauseDrawingPersistence: vi.fn(),
				flushDrawingSave,
			}),
		);

		act(() => {
			harness.emit(pointer("pointer_down", 1));
			harness.emit({ type: "misc", name: "interrupt" });
		});
		await Promise.resolve();

		expect(interactionActiveRef.current).toBe(false);
		expect(flushFrameUpdates).toHaveBeenCalledTimes(1);
		expect(flushDrawingSave).toHaveBeenCalledTimes(1);
	});
});
