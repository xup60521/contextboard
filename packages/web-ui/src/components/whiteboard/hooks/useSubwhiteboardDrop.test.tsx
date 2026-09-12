// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dispatchSubwhiteboardDrop } from "../SubwhiteboardLinkShape";
import { useSubwhiteboardDrop } from "./useSubwhiteboardDrop";

describe("useSubwhiteboardDrop", () => {
	test("moves the placement with its final frame before removing the source shape", async () => {
		const shape = {
			id: "shape:card",
			type: "markdown-card",
			x: 40,
			y: 60,
			rotation: 0.25,
			props: { w: 500, h: 300 },
		} as never;
		const target = {
			id: "shape:target",
			type: "subwhiteboard-link",
			props: { childWhiteboardId: "board:target" },
		} as never;
		const deleteShapes = vi.fn();
		const editor = {
			getCurrentPageShapesSorted: () => [shape, target],
			deleteShapes,
		} as never;
		const moveItem = vi.fn().mockResolvedValue(undefined);
		const queueFrameUpdate = vi.fn();
		const itemIdByShapeIdRef = {
			current: new Map([[shape.id, "item:card"]]),
		};
		const latestItemsRef = {
			current: new Map([["item:card", {}]]),
		};
		const optimisticFramesRef = {
			current: new Map([["item:card", {}]]),
		};
		const queuedFrameUpdatesRef = {
			current: new Map([["item:card", {}]]),
		};

		renderHook(() =>
			useSubwhiteboardDrop({
				editor,
				moveItem,
				queueFrameUpdate,
				hydratingRef: { current: false },
				itemIdByShapeIdRef: itemIdByShapeIdRef as never,
				latestItemsRef: latestItemsRef as never,
				optimisticFramesRef: optimisticFramesRef as never,
				queuedFrameUpdatesRef: queuedFrameUpdatesRef as never,
			}),
		);

		act(() => dispatchSubwhiteboardDrop(editor, target, [shape]));

		expect(queuedFrameUpdatesRef.current.has("item:card")).toBe(false);
		expect(moveItem).toHaveBeenCalledWith({
			itemId: "item:card",
			targetWhiteboardId: "board:target",
			x: 40,
			y: 60,
			w: 500,
			h: 300,
			rotation: 0.25,
			zIndex: 0,
		});
		await waitFor(() => expect(deleteShapes).toHaveBeenCalledWith([shape.id]));
		expect(itemIdByShapeIdRef.current.has(shape.id)).toBe(false);
		expect(latestItemsRef.current.has("item:card")).toBe(false);
		expect(optimisticFramesRef.current.has("item:card")).toBe(false);
		expect(queueFrameUpdate).not.toHaveBeenCalled();
	});
});
