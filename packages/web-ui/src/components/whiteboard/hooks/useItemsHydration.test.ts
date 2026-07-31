import { describe, expect, test } from "vitest";
import { getStaleManagedShapeIds } from "./useItemsHydration";

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
