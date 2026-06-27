import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
	selectPreferredPlacement,
	type ActiveCardPlacement,
} from "./cardPlacements";

function makePlacement(
	id: string,
	whiteboardId: string,
	updatedAt: number,
): ActiveCardPlacement {
	return {
		_id: id as Id<"boardItems">,
		cardId: "card-1" as Id<"cards">,
		whiteboardId: whiteboardId as Id<"whiteboards">,
		shapeId: `shape:${id}`,
		updatedAt,
	};
}

describe("selectPreferredPlacement", () => {
	test("prefers the current board placement when available", () => {
		const placements = [
			makePlacement("item-a", "board-a", 100),
			makePlacement("item-b", "board-b", 200),
		];

		expect(selectPreferredPlacement(placements, "board-a" as Id<"whiteboards">))
			.toMatchObject({
				_id: "item-a",
			});
	});

	test("falls back to the most recently updated placement", () => {
		const placements = [
			makePlacement("item-a", "board-a", 100),
			makePlacement("item-b", "board-b", 200),
		];

		expect(selectPreferredPlacement(placements)).toMatchObject({
			_id: "item-b",
		});
	});
});
