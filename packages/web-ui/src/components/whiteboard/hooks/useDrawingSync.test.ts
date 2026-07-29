// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { mergeCanvasRecordDeltas } from "./useDrawingSync";

const empty = { added: [], updated: [], removed: [] };

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
});
