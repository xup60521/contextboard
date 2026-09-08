import { describe, expect, test } from "vitest";
import {
	CARD_GRID_GAP,
	CARD_TILE_HEIGHT,
	getCardBox,
	getCardGridMetrics,
	hitTestCardIds,
} from "./cardGridGeometry";

describe("cardGridGeometry", () => {
	test.each([
		[0, 1],
		[199, 1],
		[200, 1],
		[411, 1],
		[412, 2],
		[624, 3],
	])("uses %ipx for %i columns", (width, columns) => {
		expect(getCardGridMetrics(width).columns).toBe(columns);
	});

	test("derives a card box from its index", () => {
		const metrics = getCardGridMetrics(624);

		expect(getCardBox(4, metrics, { left: 10, top: 20 })).toEqual({
			left: 222,
			right: 422,
			top: 202,
			bottom: 202 + CARD_TILE_HEIGHT,
		});
	});

	test("hit-tests the whole id set and ignores gutters", () => {
		const ids = ["a", "b", "c", "d"];
		const metrics = getCardGridMetrics(412);

		expect(
			hitTestCardIds(
				ids,
				{ left: 0, right: 412, top: 0, bottom: 400 },
				metrics,
			),
		).toEqual(ids);
		expect(
			hitTestCardIds(
				ids,
				{
					left: 200,
					right: 200 + CARD_GRID_GAP,
					top: 0,
					bottom: CARD_TILE_HEIGHT,
				},
				metrics,
			),
		).toEqual([]);
	});
});
