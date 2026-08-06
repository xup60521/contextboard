// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { mergeCanvasRecordDeltas, useDrawingSync } from "./useDrawingSync";

const empty = { added: [], updated: [], removed: [] };

afterEach(() => {
	vi.useRealTimers();
});

describe("mergeCanvasRecordDeltas", () => {
	test("collapses repeated updates to the latest payload", () => {
		const result = mergeCanvasRecordDeltas(
			{ ...empty, updated: [{ id: "shape:a", x: 1 }] },
			{ ...empty, updated: [{ id: "shape:a", x: 2 }] },
		);
		expect(result).toEqual({
			added: [],
			updated: [{ id: "shape:a", x: 2 }],
			removed: [],
		});
	});

	test("keeps an updated addition as one addition", () => {
		const result = mergeCanvasRecordDeltas(
			{ ...empty, added: [{ id: "shape:a", x: 1 }] },
			{ ...empty, updated: [{ id: "shape:a", x: 2 }] },
		);
		expect(result).toEqual({
			added: [{ id: "shape:a", x: 2 }],
			updated: [],
			removed: [],
		});
	});

	test("cancels add then remove and deduplicates removals", () => {
		expect(
			mergeCanvasRecordDeltas(
				{ ...empty, added: [{ id: "shape:a" }] },
				{ ...empty, removed: ["shape:a", "shape:a"] },
			),
		).toEqual(empty);

		expect(
			mergeCanvasRecordDeltas(
				{ ...empty, updated: [{ id: "shape:b", x: 1 }] },
				{ ...empty, removed: ["shape:b", "shape:b"] },
			),
		).toEqual({ added: [], updated: [], removed: ["shape:b"] });
	});

	test("keeps drawing persistence pending until the interaction is released", async () => {
		vi.useFakeTimers();
		const applyCanvasRecordChanges = vi
			.fn()
			.mockResolvedValue({ versions: { "shape:a": 1 } });
		const interactionActiveRef = { current: true };
		const { result } = renderHook(() =>
			useDrawingSync({
				whiteboardId: "board:a" as never,
				applyCanvasRecordChanges,
				interactionActiveRef,
			}),
		);

		act(() => {
			result.current.queueDrawingSave({
				added: [{ id: "shape:a", x: 1 }],
				updated: [],
				removed: [],
			});
			result.current.queueDrawingSave({
				added: [],
				updated: [{ id: "shape:a", x: 2 }],
				removed: [],
			});
		});
		vi.advanceTimersByTime(1_000);
		expect(applyCanvasRecordChanges).not.toHaveBeenCalled();

		interactionActiveRef.current = false;
		await act(async () => {
			await result.current.flushDrawingSave();
		});

		expect(applyCanvasRecordChanges).toHaveBeenCalledTimes(1);
		expect(applyCanvasRecordChanges).toHaveBeenCalledWith({
			whiteboardId: "board:a",
			added: [{ id: "shape:a", x: 2 }],
			updated: [],
			removed: [],
		});
	});
});
