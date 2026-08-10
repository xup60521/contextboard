// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "../ids";
import type { BoardItemResult } from "../whiteboard-canvas-helpers";
import {
	getStaleManagedShapeIds,
	useItemsHydration,
} from "./useItemsHydration";

describe("getStaleManagedShapeIds", () => {
	test("keeps pasted shapes protected until they appear in synced items", () => {
		const staleShapeIds = getStaleManagedShapeIds(
			[{ id: "shape:pending" }, { id: "shape:stale" }],
			new Set(["shape:known"]),
			new Set(["shape:pending"]),
		);

		expect(staleShapeIds).toEqual(["shape:stale"]);
	});
});

describe("useItemsHydration", () => {
	test("reattaches deferred bindings when the item hydration gate opens", () => {
		const arrow = { id: "shape:arrow", type: "arrow" };
		const shapes = new Map<
			string,
			{ id: string; type: string; props?: object }
		>([[arrow.id, arrow]]);
		const put = vi.fn();
		const editor = {
			getCurrentPageShapes: vi.fn(() => [...shapes.values()]),
			getShape: vi.fn((id: string) => shapes.get(id)),
			run: vi.fn((callback: () => void) => callback()),
			deleteShapes: vi.fn((ids: string[]) => {
				for (const id of ids) shapes.delete(id);
			}),
			createShape: vi.fn(
				(shape: { id: string; type: string; props?: object }) => {
					shapes.set(shape.id, shape);
				},
			),
			updateShape: vi.fn(),
			select: vi.fn(),
			setEditingShape: vi.fn(),
			store: {
				put,
				mergeRemoteChanges: vi.fn((callback: () => void) => callback()),
			},
		};
		const readyBinding = {
			id: "binding:ready",
			typeName: "binding",
			type: "arrow",
			fromId: arrow.id,
			toId: "shape:card",
		};
		const pendingBinding = {
			id: "binding:pending",
			typeName: "binding",
			type: "arrow",
			fromId: arrow.id,
			toId: "shape:missing",
		};
		const deferredBindingsRef = {
			current: [readyBinding, pendingBinding] as unknown[],
		};
		const items: BoardItemResult[] = [
			{
				_id: "item:card" as Id<"boardItems">,
				kind: "card",
				cardId: "card:card" as Id<"cards">,
				childWhiteboardId: null,
				shapeId: "shape:card",
				x: 10,
				y: 20,
				w: 240,
				h: 160,
				rotation: 0,
				zIndex: 1,
				card: {
					_id: "card:card" as Id<"cards">,
					derivedTitle: "Card",
					preview: "Preview",
					version: 1,
				},
				childWhiteboard: null,
			},
		];
		const optimisticFramesRef = { current: new Map() };
		const queuedFrameUpdatesRef = { current: new Map() };
		const itemIdByShapeIdRef = { current: new Map() };
		const latestItemsRef = { current: new Map() };
		const pendingEditShapeIdRef = { current: null };
		const hydratingRef = { current: false };
		const protectedPasteShapeIdsRef = { current: new Set<string>() };

		const { rerender } = renderHook(
			({ itemsReady }: { itemsReady: boolean }) =>
				useItemsHydration({
					editor: editor as never,
					items,
					itemsReady,
					loadedDrawingKey: "board",
					whiteboardKey: "board",
					deferredBindingsRef,
					optimisticFramesRef,
					queuedFrameUpdatesRef,
					itemIdByShapeIdRef,
					latestItemsRef,
					pendingEditShapeIdRef,
					prioritizeCardContent: vi.fn(),
					scheduleVisibleCardHydration: vi.fn(),
					hydratingRef,
					protectedPasteShapeIdsRef,
					reconciliationGeneration: 0,
				}),
			{ initialProps: { itemsReady: false } },
		);

		expect(put).not.toHaveBeenCalled();
		expect(deferredBindingsRef.current).toEqual([readyBinding, pendingBinding]);

		rerender({ itemsReady: true });

		expect(shapes.has("shape:card")).toBe(true);
		expect(put).toHaveBeenCalledWith([readyBinding]);
		expect(deferredBindingsRef.current).toEqual([pendingBinding]);
	});
});
