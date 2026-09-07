import type { Editor } from "tldraw";
import { describe, expect, test, vi } from "vitest";
import {
	fitCardsToContent,
	getCardsToFit,
	getFitCardsLabel,
} from "./fit-cards-to-content";

function card(id: string) {
	return { id, type: "markdown-card", props: {} };
}

function stubEditor(
	pageShapes: ReturnType<typeof card>[],
	selectedIds: readonly string[],
) {
	const selected = new Set(selectedIds);
	return {
		getCurrentPageShapes: () => pageShapes,
		getSelectedShapes: () =>
			pageShapes.filter((shape) => selected.has(shape.id)),
		getIsReadonly: () => false,
		isShapeOrAncestorLocked: () => false,
		markHistoryStoppingPoint: vi.fn(),
	} as unknown as Editor;
}

describe("fit cards to content", () => {
	test.each([
		[[], "Fit all cards to content"],
		[["a", "b", "c"], "Fit all cards to content"],
		[["a"], "Fit 1 card to content"],
		[["a", "b"], "Fit 2 cards to content"],
	] as const)("labels a selection of %j", (selectedIds, expected) => {
		const editor = stubEditor([card("a"), card("b"), card("c")], selectedIds);

		expect(getFitCardsLabel(editor)).toBe(expected);
	});

	test("fits only a partial card selection", () => {
		const editor = stubEditor([card("a"), card("b"), card("c")], ["a"]);

		expect(getCardsToFit(editor).map((shape) => shape.id)).toEqual(["a"]);
	});

	test("queues all cards when the selection is empty or complete", () => {
		for (const selectedIds of [[], ["a", "b", "c"]]) {
			const editor = stubEditor([card("a"), card("b"), card("c")], selectedIds);

			fitCardsToContent(editor);

			expect(editor.markHistoryStoppingPoint).toHaveBeenCalledWith(
				"fit cards to content",
			);
		}
	});
});
