import { describe, expect, test } from "vitest";
import {
	applyFrameToShape,
	frameFromItem,
	framesEqual,
	resolveFrameForHydration,
	shouldClearOptimisticFrame,
	type WhiteboardFrame,
} from "./frame-sync";

const serverFrame: WhiteboardFrame = {
	x: 10,
	y: 20,
	w: 360,
	h: 160,
	rotation: 0,
	zIndex: 3,
};

const localFrame: WhiteboardFrame = {
	x: 140,
	y: 220,
	w: 360,
	h: 160,
	rotation: 0,
	zIndex: 5,
};

describe("whiteboard frame sync", () => {
	test("uses an optimistic frame while the server still has stale geometry", () => {
		const result = resolveFrameForHydration(serverFrame, {
			seq: 1,
			frame: localFrame,
		});

		expect(result).toEqual({ frame: localFrame, acknowledged: false });
	});

	test("acknowledges and clears an optimistic frame once the server catches up", () => {
		const result = resolveFrameForHydration(localFrame, {
			seq: 1,
			frame: localFrame,
		});

		expect(result).toEqual({ frame: localFrame, acknowledged: true });
	});

	test("applies local geometry without replacing server content props", () => {
		const shape = {
			id: "shape:card",
			type: "markdown-card",
			x: serverFrame.x,
			y: serverFrame.y,
			rotation: serverFrame.rotation,
			props: {
				w: serverFrame.w,
				h: serverFrame.h,
				content: "server content",
				cardId: "card-id",
				version: 2,
			},
		};

		expect(applyFrameToShape(shape, localFrame)).toEqual({
			...shape,
			x: localFrame.x,
			y: localFrame.y,
			rotation: localFrame.rotation,
			props: {
				...shape.props,
				w: localFrame.w,
				h: localFrame.h,
			},
		});
	});

	test("does not clear a newer optimistic frame when an older request fails", () => {
		expect(shouldClearOptimisticFrame({ seq: 2, frame: localFrame }, 1)).toBe(
			false,
		);
		expect(shouldClearOptimisticFrame({ seq: 2, frame: localFrame }, 2)).toBe(
			true,
		);
	});

	test("extracts comparable frames from server items", () => {
		const item = {
			...serverFrame,
			_id: "item-id",
			shapeId: "shape:card",
		};

		expect(framesEqual(frameFromItem(item), serverFrame)).toBe(true);
	});
});
