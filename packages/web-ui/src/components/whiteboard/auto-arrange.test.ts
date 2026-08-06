import type { ArrangeStyle } from "@contextboard/application/canvas";
import type { Editor } from "tldraw";
import { describe, expect, test } from "vitest";
import { buildAutoArrangePlan, canAutoArrange } from "./auto-arrange";

type StubShape = {
	id: string;
	type: string;
	x: number;
	y: number;
	props: Record<string, unknown>;
};

function cardShape(id: string, x = 0, y = 0, w = 576, h = 180): StubShape {
	return {
		id,
		type: "markdown-card",
		x,
		y,
		props: { w, h, cardId: `card-${id}` },
	};
}

/** An arrow bound to two shapes, in the record shape tldraw reports. */
function arrow(id: string, from: string, to: string) {
	return {
		shape: { id, type: "arrow", x: 0, y: 0, props: {} },
		bindings: [
			{ toId: from, props: { terminal: "start" } },
			{ toId: to, props: { terminal: "end" } },
		],
	};
}

/**
 * The slice of the editor `auto-arrange` actually touches. A stub keeps the test
 * on the adapter's own logic instead of standing a real tldraw store up.
 */
function stubEditor(
	shapes: StubShape[],
	arrows: ReturnType<typeof arrow>[],
	selectedIds: string[],
): Editor {
	const pageShapes = [...shapes, ...arrows.map((entry) => entry.shape)];
	const bindings = new Map(
		arrows.map((entry) => [entry.shape.id, entry.bindings]),
	);
	return {
		getCurrentPageShapes: () => pageShapes,
		getSelectedShapes: () =>
			shapes.filter((shape) => selectedIds.includes(shape.id)),
		getBindingsFromShape: (shapeId: string) => bindings.get(shapeId) ?? [],
		getShape: (shapeId: string) =>
			pageShapes.find((shape) => shape.id === shapeId),
		getShapePageBounds: (shapeId: string) => {
			const shape = pageShapes.find((entry) => entry.id === shapeId);
			if (!shape) return undefined;
			return {
				x: shape.x,
				y: shape.y,
				w: (shape.props.w as number) ?? 100,
				h: (shape.props.h as number) ?? 100,
			};
		},
	} as unknown as Editor;
}

describe("canAutoArrange", () => {
	test("needs two selected cards with an arrow between them", () => {
		const shapes = [cardShape("a"), cardShape("b", 900)];
		const arrows = [arrow("shape:arrow", "a", "b")];

		expect(canAutoArrange(stubEditor(shapes, arrows, ["a", "b"]))).toBe(true);
		expect(canAutoArrange(stubEditor(shapes, arrows, ["a"]))).toBe(false);
		expect(canAutoArrange(stubEditor(shapes, [], ["a", "b"]))).toBe(false);
	});

	test("ignores an arrow that leaves the selection", () => {
		const shapes = [cardShape("a"), cardShape("b", 900), cardShape("c", 1800)];
		const arrows = [arrow("shape:arrow", "a", "c")];

		expect(canAutoArrange(stubEditor(shapes, arrows, ["a", "b"]))).toBe(false);
	});
});

describe("buildAutoArrangePlan", () => {
	test("moves the selected cards into a tree", () => {
		const shapes = [cardShape("a", 400, 400), cardShape("b", 0, 900)];
		const editor = stubEditor(
			shapes,
			[arrow("shape:arrow", "a", "b")],
			["a", "b"],
		);

		const plan = buildAutoArrangePlan(editor);

		expect(plan.style).toBe("tree-horizontal");
		expect(plan.updates).toHaveLength(2);
		const byId = new Map(plan.updates.map((update) => [update.id, update]));
		expect((byId.get("b") as { x: number }).x).toBeGreaterThan(
			(byId.get("a") as { x: number }).x,
		);
		// Every update carries the shape's own type, which tldraw requires.
		for (const update of plan.updates)
			expect(update.type).toBe("markdown-card");
	});

	test.each([
		"tree-horizontal",
		"tree-vertical",
		"mindmap",
	] as const)("forwards the explicit %s style", (style: ArrangeStyle) => {
		const editor = stubEditor(
			[cardShape("a"), cardShape("b", 900)],
			[arrow("shape:arrow", "a", "b")],
			["a", "b"],
		);

		expect(buildAutoArrangePlan(editor, style).style).toBe(style);
	});

	test("never touches an unselected card or a freehand stroke", () => {
		const shapes = [cardShape("a"), cardShape("b", 900)];
		const stroke = {
			id: "shape:stroke",
			type: "draw",
			x: 0,
			y: 2000,
			props: { w: 200, h: 200 },
		};
		const editor = stubEditor(
			[...shapes, stroke, cardShape("outsider", 0, 4000)],
			[arrow("shape:arrow", "a", "b")],
			["a", "b"],
		);

		const plan = buildAutoArrangePlan(editor);

		const moved = plan.updates.map((update) => update.id);
		expect(moved).not.toContain("shape:stroke");
		expect(moved).not.toContain("outsider");
	});

	test("reports a selected card that has no relation, without moving it", () => {
		const shapes = [
			cardShape("a"),
			cardShape("b", 900),
			cardShape("lonely", 0, 3000),
		];
		const editor = stubEditor(
			shapes,
			[arrow("shape:arrow", "a", "b")],
			["a", "b", "lonely"],
		);

		const plan = buildAutoArrangePlan(editor);

		expect(plan.skippedShapeIds).toEqual(["lonely"]);
		expect(plan.updates.map((update) => update.id)).not.toContain("lonely");
	});

	test("has nothing to do when the selection has no arrows", () => {
		const editor = stubEditor(
			[cardShape("a"), cardShape("b", 900)],
			[],
			["a", "b"],
		);

		expect(buildAutoArrangePlan(editor).updates).toEqual([]);
	});
});
