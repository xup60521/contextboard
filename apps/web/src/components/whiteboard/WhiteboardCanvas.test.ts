import { type Editor, Vec } from "tldraw";
import { describe, expect, test } from "vitest";
import type { MarkdownCardShape } from "./custom-shapes";
import {
	collectGlobalDeleteCardIdsFromShapes,
	getRightDragPanNextCamera,
	hasExceededRightDragPanThreshold,
	hasManagedShapeFrameChanged,
	isGlobalCardDeleteShortcut,
	itemToShape,
	syncRightDragPanPointer,
} from "./WhiteboardCanvas";
import type { ManagedWhiteboardShape } from "./whiteboard-canvas-helpers";

type ManagedFrameTestShape = ManagedWhiteboardShape & { index?: string };

function createManagedFrameShape(
	overrides: Partial<ManagedFrameTestShape> = {},
): ManagedFrameTestShape {
	const base = {
		id: "shape:card",
		type: "markdown-card",
		x: 10,
		y: 20,
		rotation: 0,
		props: {
			w: 320,
			h: 160,
			content: "{}",
			title: "Title",
			preview: "Preview",
			contentLoaded: true,
			contentVersion: 1,
		},
	} as MarkdownCardShape;

	return {
		...base,
		...overrides,
		props: {
			...base.props,
			...(overrides.props ?? {}),
		},
	};
}

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
				derivedTitle: "Card",
				preview: "Preview",
				version: 1,
			},
			childWhiteboard: null,
		} as never);

		expect(shape.type).toBe("markdown-card");
		expect(shape.props.h).toBeGreaterThan(64);
		if (shape.type === "markdown-card") {
			expect(shape.props.content).toBe("");
			expect(shape.props.contentLoaded).toBe(false);
		}
	});

	test("hydrates Convex-backed cards as unloaded summary shells", () => {
		const shape = itemToShape({
			_id: "item-1",
			kind: "card",
			cardId: "card-1",
			childWhiteboardId: null,
			shapeId: "shape:card",
			x: 20,
			y: 40,
			w: 320,
			h: 160,
			rotation: 0,
			zIndex: 2,
			card: {
				_id: "card-1",
				derivedTitle: "Card",
				preview: "Preview text",
				version: 7,
			},
			childWhiteboard: null,
		} as never);

		expect(shape.type).toBe("markdown-card");
		if (shape.type === "markdown-card") {
			expect(shape.props).toMatchObject({
				cardId: "card-1",
				title: "Card",
				preview: "Preview text",
				content: "",
				contentLoaded: false,
				contentVersion: 7,
			});
		}
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

	test("hydrates board item shape ids that are valid tldraw ids", () => {
		const shape = itemToShape({
			_id: "item-1",
			kind: "card",
			cardId: "card-1",
			childWhiteboardId: null,
			shapeId: "shape:card-abc123",
			x: 0,
			y: 0,
			w: 576,
			h: 160,
			rotation: 0,
			zIndex: 1,
			card: {
				_id: "card-1",
				derivedTitle: "Card",
				preview: "Preview",
				version: 1,
			},
			childWhiteboard: null,
		} as never);

		expect(shape.id).toBe("shape:card-abc123");
	});

	test("normalizes legacy shape ids without shape: prefix", () => {
		const shape = itemToShape({
			_id: "item-2",
			kind: "card",
			cardId: "card-2",
			childWhiteboardId: null,
			shapeId: "card-legacy123",
			x: 0,
			y: 0,
			w: 576,
			h: 160,
			rotation: 0,
			zIndex: 1,
			card: {
				_id: "card-2",
				derivedTitle: "Card",
				preview: "Preview",
				version: 1,
			},
			childWhiteboard: null,
		} as never);

		expect(shape.id).toBe("shape:card-legacy123");
	});

	test("normalizes legacy subwhiteboard shape ids without shape: prefix", () => {
		const shape = itemToShape({
			_id: "item-3",
			kind: "subwhiteboard",
			cardId: null,
			childWhiteboardId: "wb-1",
			shapeId: "sub-legacy456",
			x: 0,
			y: 0,
			w: 240,
			h: 92,
			rotation: 0,
			zIndex: 1,
			card: null,
			childWhiteboard: {
				_id: "wb-1",
				title: "Sub",
				depth: 1,
				cardCount: 0,
				childWhiteboardCount: 0,
			},
		} as never);

		expect(shape.id).toBe("shape:sub-legacy456");
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
			getRightDragPanNextCamera({ x: 10, y: 20, z: 2 }, { x: 8, y: -4 }),
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

describe("collectGlobalDeleteCardIdsFromShapes", () => {
	test("collects card ids from selected markdown cards", () => {
		const result = collectGlobalDeleteCardIdsFromShapes([
			{
				id: "shape:one",
				type: "markdown-card",
				props: {
					w: 576,
					h: 160,
					content: "{}",
					cardId: "card-1",
				},
			} as never,
		]);

		expect(result).toEqual(["card-1"]);
	});

	test("dedupes multiple placements of the same card", () => {
		const result = collectGlobalDeleteCardIdsFromShapes([
			{
				id: "shape:one",
				type: "markdown-card",
				props: { w: 576, h: 160, content: "{}", cardId: "card-1" },
			} as never,
			{
				id: "shape:two",
				type: "markdown-card",
				props: { w: 576, h: 160, content: "{}", cardId: "card-1" },
			} as never,
		]);

		expect(result).toEqual(["card-1"]);
	});

	test("includes two different card ids if two different cards are selected", () => {
		const result = collectGlobalDeleteCardIdsFromShapes([
			{
				id: "shape:one",
				type: "markdown-card",
				props: { w: 576, h: 160, content: "{}", cardId: "card-1" },
			} as never,
			{
				id: "shape:two",
				type: "markdown-card",
				props: { w: 576, h: 160, content: "{}", cardId: "card-2" },
			} as never,
		]);

		expect(result.sort()).toEqual(["card-1", "card-2"]);
	});

	test("ignores non-card and local markdown shapes", () => {
		const result = collectGlobalDeleteCardIdsFromShapes([
			{
				id: "shape:local",
				type: "markdown-card",
				props: { w: 576, h: 160, content: "{}" },
			} as never,
			{
				id: "shape:whiteboard",
				type: "subwhiteboard-link",
				props: {
					w: 240,
					h: 92,
					label: "Nested",
					subwhiteboardId: "wb-1",
					childWhiteboardId: "wb-1",
				},
			} as never,
		]);

		expect(result).toEqual([]);
	});
});

describe("hasManagedShapeFrameChanged", () => {
	test("ignores markdown-card content and metadata changes", () => {
		const previous = createManagedFrameShape();
		const next = createManagedFrameShape({
			props: {
				w: 320,
				h: 160,
				content: '{"type":"doc"}',
				title: "Updated title",
				preview: "Updated preview",
				contentLoaded: false,
				contentVersion: 2,
			},
		});

		expect(hasManagedShapeFrameChanged(previous, next)).toBe(false);
	});

	test("detects persisted geometry changes", () => {
		const previous = createManagedFrameShape();

		for (const next of [
			createManagedFrameShape({ x: 11 }),
			createManagedFrameShape({ y: 21 }),
			createManagedFrameShape({ rotation: 0.25 }),
			createManagedFrameShape({ props: { ...previous.props, w: 321 } }),
			createManagedFrameShape({ props: { ...previous.props, h: 161 } }),
		]) {
			expect(hasManagedShapeFrameChanged(previous, next)).toBe(true);
		}
	});

	test("detects tldraw ordering changes when present", () => {
		const previous = createManagedFrameShape({ index: "a1" });
		const next = createManagedFrameShape({ index: "a2" });

		expect(hasManagedShapeFrameChanged(previous, next)).toBe(true);
	});
});

describe("isGlobalCardDeleteShortcut", () => {
	test("matches Ctrl+Delete only", () => {
		expect(
			isGlobalCardDeleteShortcut({
				key: "Delete",
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
				repeat: false,
			}),
		).toBe(true);

		expect(
			isGlobalCardDeleteShortcut({
				key: "Delete",
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
				repeat: false,
			}),
		).toBe(false);

		expect(
			isGlobalCardDeleteShortcut({
				key: "Backspace",
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
				repeat: false,
			}),
		).toBe(false);

		expect(
			isGlobalCardDeleteShortcut({
				key: "Delete",
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
				repeat: true,
			}),
		).toBe(false);
	});
});
