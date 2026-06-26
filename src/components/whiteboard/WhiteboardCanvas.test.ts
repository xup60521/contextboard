import { type Editor, Vec } from "tldraw";
import { describe, expect, test } from "vitest";
import {
	getRightDragPanNextCamera,
	hasExceededRightDragPanThreshold,
	itemToShape,
	syncRightDragPanPointer,
} from "./WhiteboardCanvas";

describe("itemToShape", () => {
	test("uses a hydrated height floor for markdown cards", () => {
		const shape = itemToShape({
			_id: "item-1",
			kind: "card",
			cardId: "card-1",
			childWhiteboardId: null,
			shapeId: "shape:card",
			x: 20,
			y: 40,
			w: 320,
			h: 64,
			rotation: 0,
			zIndex: 2,
			card: {
				_id: "card-1",
				content: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "A".repeat(600) }],
						},
					],
				},
				derivedTitle: "Card",
				version: 1,
			},
			childWhiteboard: null,
		} as never);

		expect(shape.type).toBe("markdown-card");
		expect(shape.props.h).toBeGreaterThan(64);
	});

	test("leaves non-markdown board items on their persisted height", () => {
		const shape = itemToShape({
			_id: "item-2",
			kind: "subwhiteboard",
			cardId: null,
			childWhiteboardId: "wb-1",
			shapeId: "shape:sub",
			x: 20,
			y: 40,
			w: 220,
			h: 84,
			rotation: 0,
			zIndex: 2,
			card: null,
			childWhiteboard: {
				_id: "wb-1",
				title: "Nested",
				depth: 2,
				cardCount: 3,
				childWhiteboardCount: 1,
			},
		} as never);

		expect(shape.type).toBe("subwhiteboard-link");
		expect(shape.props.h).toBe(84);
	});

	test("starts right-drag panning only after a small movement threshold", () => {
		expect(
			hasExceededRightDragPanThreshold({
				startClientX: 100,
				startClientY: 100,
				currentClientX: 104,
				currentClientY: 104,
			}),
		).toBe(false);

		expect(
			hasExceededRightDragPanThreshold({
				startClientX: 100,
				startClientY: 100,
				currentClientX: 106,
				currentClientY: 100,
			}),
		).toBe(true);
	});

	test("converts screen-space right drag into zoom-aware camera panning", () => {
		expect(
			getRightDragPanNextCamera(
				{ x: 10, y: 20, z: 2 },
				{ x: 8, y: -4 },
			),
		).toEqual({
			x: 14,
			y: 18,
			z: 2,
		});
	});

	test("syncs right-drag pan pointer to the real cursor position", () => {
		const pagePoint = new Vec(42, 84, 0.25);
		const editor = {
			inputs: {
				previousScreenPoint: new Vec(1, 2),
				previousPagePoint: new Vec(3, 4),
				currentScreenPoint: new Vec(11, 22),
				currentPagePoint: new Vec(33, 44),
			},
			getViewportScreenBounds: () => ({ x: 10, y: 20 }),
			screenToPage: () => pagePoint,
		} as unknown as Pick<
			Editor,
			"inputs" | "getViewportScreenBounds" | "screenToPage"
		>;

		syncRightDragPanPointer(editor, { x: 110, y: 220, z: 0.25 });

		expect(editor.inputs.currentScreenPoint.x).toBe(100);
		expect(editor.inputs.currentScreenPoint.y).toBe(200);
		expect(editor.inputs.previousScreenPoint.x).toBe(11);
		expect(editor.inputs.previousScreenPoint.y).toBe(22);
		expect(editor.inputs.previousPagePoint.x).toBe(33);
		expect(editor.inputs.previousPagePoint.y).toBe(44);
		expect(editor.inputs.currentPagePoint.x).toBe(42);
		expect(editor.inputs.currentPagePoint.y).toBe(84);
		expect(editor.inputs.currentPagePoint.z).toBe(0.25);
	});
});
