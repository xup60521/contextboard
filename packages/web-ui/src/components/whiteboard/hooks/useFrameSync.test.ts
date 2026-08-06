// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useFrameSync } from "./useFrameSync";

const frame = (x: number) => ({
	x,
	y: x + 1,
	w: 300,
	h: 200,
	rotation: 0,
	zIndex: 1,
});

function item(id: string) {
	return {
		_id: id,
		kind: "card",
		cardId: `card:${id}`,
		childWhiteboardId: null,
		shapeId: `shape:${id}`,
		x: 0,
		y: 0,
		w: 300,
		h: 200,
		rotation: 0,
		zIndex: 1,
		card: null,
		childWhiteboard: null,
	} as never;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("useFrameSync", () => {
	test("flushes all queued item frames in one batch", async () => {
		vi.useFakeTimers();
		const updateItemFrames = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			useFrameSync({
				editor: null,
				updateItemFrames,
				latestItemsRef: { current: new Map() },
				optimisticFramesRef: { current: new Map() },
				hydratingRef: { current: false },
				interactionActiveRef: { current: false },
			}),
		);

		result.current.queueFrameUpdate("item:a" as never, frame(10));
		result.current.queueFrameUpdate("item:b" as never, frame(20));
		vi.advanceTimersByTime(250);
		await Promise.resolve();

		expect(updateItemFrames).toHaveBeenCalledTimes(1);
		expect(updateItemFrames).toHaveBeenCalledWith({
			updates: [
				{ itemId: "item:a", ...frame(10) },
				{ itemId: "item:b", ...frame(20) },
			],
		});
	});

	test("rolls back a failed batch in one editor transaction", async () => {
		vi.useFakeTimers();
		const updateItemFrames = vi.fn().mockRejectedValue(new Error("conflict"));
		const editor = {
			run: vi.fn((callback: () => void) => callback()),
			getShape: vi.fn(() => undefined),
			createShape: vi.fn(),
		};
		const latestItemsRef = {
			current: new Map([
				["item:a" as never, item("item:a")],
				["item:b" as never, item("item:b")],
			]),
		};
		const optimisticFramesRef = { current: new Map() };
		const { result } = renderHook(() =>
			useFrameSync({
				editor: editor as never,
				updateItemFrames,
				latestItemsRef,
				optimisticFramesRef,
				hydratingRef: { current: false },
				interactionActiveRef: { current: false },
			}),
		);

		result.current.queueFrameUpdate("item:a" as never, frame(10));
		result.current.queueFrameUpdate("item:b" as never, frame(20));
		vi.advanceTimersByTime(250);
		await Promise.resolve();

		expect(editor.run).toHaveBeenCalledTimes(1);
		expect(editor.createShape).toHaveBeenCalledTimes(2);
		expect(optimisticFramesRef.current.size).toBe(0);
	});

	test("keeps frame persistence pending until the interaction is released", async () => {
		vi.useFakeTimers();
		const updateItemFrames = vi.fn().mockResolvedValue(undefined);
		const interactionActiveRef = { current: true };
		const { result } = renderHook(() =>
			useFrameSync({
				editor: null,
				updateItemFrames,
				latestItemsRef: { current: new Map() },
				optimisticFramesRef: { current: new Map() },
				hydratingRef: { current: false },
				interactionActiveRef,
			}),
		);

		result.current.queueFrameUpdate("item:a" as never, frame(10));
		vi.advanceTimersByTime(1_000);
		expect(updateItemFrames).not.toHaveBeenCalled();

		interactionActiveRef.current = false;
		result.current.flushFrameUpdates();
		await Promise.resolve();

		expect(updateItemFrames).toHaveBeenCalledWith({
			updates: [{ itemId: "item:a", ...frame(10) }],
		});
	});

	test("cancels an already scheduled flush when an interaction starts", () => {
		vi.useFakeTimers();
		const updateItemFrames = vi.fn().mockResolvedValue(undefined);
		const interactionActiveRef = { current: false };
		const { result } = renderHook(() =>
			useFrameSync({
				editor: null,
				updateItemFrames,
				latestItemsRef: { current: new Map() },
				optimisticFramesRef: { current: new Map() },
				hydratingRef: { current: false },
				interactionActiveRef,
			}),
		);

		result.current.queueFrameUpdate("item:a" as never, frame(10));
		interactionActiveRef.current = true;
		result.current.pauseFramePersistence();
		vi.advanceTimersByTime(1_000);

		expect(updateItemFrames).not.toHaveBeenCalled();
	});
});
