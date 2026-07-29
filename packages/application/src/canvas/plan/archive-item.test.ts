import { describe, expect, test } from "vitest";
import { planArchiveItem } from "./archive-item";

describe("planArchiveItem", () => {
	test("archives a placement and derives the card placement count", () => {
		const plan = planArchiveItem(
			{
				item: { id: "item-1", revision: 4, cardId: "card-1", archivedAt: null },
				card: {
					id: "card-1",
					revision: 7,
					activePlacementCount: 1,
					archivedAt: null,
				},
			},
			{ deleteCards: true },
			{ now: 100 },
		);
		expect(plan.writes).toEqual([
			expect.objectContaining({
				entity: "boardItem",
				id: "item-1",
				expectedRevision: 4,
			}),
			expect.objectContaining({
				entity: "card",
				id: "card-1",
				expectedRevision: 7,
				value: expect.objectContaining({
					activePlacementCount: 0,
					archivedAt: 100,
				}),
			}),
		]);
	});
});
