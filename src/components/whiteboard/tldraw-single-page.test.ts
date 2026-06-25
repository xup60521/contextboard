import type { TLUiActionItem, TLUiActionsContextType } from "tldraw";
import { describe, expect, test } from "vitest";
import {
	removeTldrawPageActions,
	singlePageTldrawComponents,
	singlePageTldrawOptions,
} from "./tldraw-single-page";

const action = (id: string): TLUiActionItem => ({
	id,
	onSelect: () => undefined,
});

describe("single-page tldraw configuration", () => {
	test("limits tldraw to one page", () => {
		expect(singlePageTldrawOptions.maxPages).toBe(1);
	});

	test("hides the built-in page menu", () => {
		expect(singlePageTldrawComponents.PageMenu).toBeNull();
	});

	test("removes page navigation and creation actions", () => {
		const filtered = removeTldrawPageActions({
			"change-page-prev": action("change-page-prev"),
			"change-page-next": action("change-page-next"),
			"move-to-new-page": action("move-to-new-page"),
			undo: action("undo"),
		});

		expect(filtered["change-page-prev"]).toBeUndefined();
		expect(filtered["change-page-next"]).toBeUndefined();
		expect(filtered["move-to-new-page"]).toBeUndefined();
	});

	test("preserves unrelated actions", () => {
		const undo = action("undo");
		const redo = action("redo");
		const zoomIn = action("zoom-in");

		const filtered = removeTldrawPageActions({
			undo,
			redo,
			"zoom-in": zoomIn,
			"move-to-new-page": action("move-to-new-page"),
		});

		expect(filtered.undo).toBe(undo);
		expect(filtered.redo).toBe(redo);
		expect(filtered["zoom-in"]).toBe(zoomIn);
	});

	test("does not mutate the original actions object", () => {
		const actions: TLUiActionsContextType = {
			"change-page-next": action("change-page-next"),
			undo: action("undo"),
		};

		const filtered = removeTldrawPageActions(actions);

		expect(filtered).not.toBe(actions);
		expect(actions["change-page-next"]).toBeDefined();
		expect(actions.undo).toBeDefined();
	});
});
