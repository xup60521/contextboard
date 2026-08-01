import type { Editor } from "tldraw";
import { describe, expect, test } from "vitest";
import { collectCanvasCardRelations } from "./card-relations";

function editorFixture(bindings: unknown[], endType = "markdown-card") {
	const shapes = new Map([
		["shape:arrow", { id: "shape:arrow", type: "arrow", props: {} }],
		[
			"shape:a",
			{ id: "shape:a", type: "markdown-card", props: { cardId: "card-b" } },
		],
		["shape:b", { id: "shape:b", type: endType, props: { cardId: "card-a" } }],
	]);
	return {
		getCurrentPageShapes: () => [shapes.get("shape:arrow")],
		getBindingsFromShape: () => bindings,
		getShape: (id: string) => shapes.get(id),
	} as unknown as Editor;
}

describe("collectCanvasCardRelations", () => {
	test("extracts and normalizes two card endpoints", () => {
		const editor = editorFixture([
			{ toId: "shape:a", props: { terminal: "start" } },
			{ toId: "shape:b", props: { terminal: "end" } },
		]);
		expect(collectCanvasCardRelations(editor)).toEqual([
			{ arrowShapeId: "shape:arrow", cardIds: ["card-a", "card-b"] },
		]);
	});

	test("ignores incomplete and non-card bindings", () => {
		expect(
			collectCanvasCardRelations(
				editorFixture([{ toId: "shape:a", props: { terminal: "start" } }]),
			),
		).toEqual([]);
		expect(
			collectCanvasCardRelations(
				editorFixture(
					[
						{ toId: "shape:a", props: { terminal: "start" } },
						{ toId: "shape:b", props: { terminal: "end" } },
					],
					"geo",
				),
			),
		).toEqual([]);
	});
});
