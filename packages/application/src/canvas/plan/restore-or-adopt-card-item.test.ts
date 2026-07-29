import { describe, expect, test } from "vitest";
import { planRestoreOrAdoptCardItem } from "./restore-or-adopt-card-item";

const input = {
	whiteboardId: "board",
	cardId: "new-card",
	itemId: "new-item",
	shapeId: "shape",
	content: { type: "doc", content: [] },
	x: 0,
	y: 0,
	w: 576,
	h: 180,
	rotation: 0,
};
const context = { now: 100, deviceId: "device" };

describe("planRestoreOrAdoptCardItem", () => {
	test("restores an archived placement and its card", () => {
		const plan = planRestoreOrAdoptCardItem(
			{
				existingPlacement: {
					id: "item",
					revision: 2,
					kind: "card",
					cardId: "card",
					archivedAt: 50,
					deletedAt: null,
				},
				existingCard: {
					id: "card",
					revision: 4,
					activePlacementCount: 0,
					archivedAt: 50,
					deletedAt: null,
				},
				sourceCard: null,
			},
			input,
			context,
		);
		expect(plan.writes.map((write) => write.expectedRevision)).toEqual([2, 4]);
		expect(plan.result.itemId).toBe("item");
	});

	test("adopts content when no reusable card exists", () => {
		const plan = planRestoreOrAdoptCardItem(
			{ existingPlacement: null, existingCard: null, sourceCard: null },
			input,
			context,
		);
		expect(plan.writes.map((write) => write.entity)).toEqual([
			"card",
			"boardItem",
		]);
		expect(plan.result).toEqual({
			itemId: "new-item",
			adoptedCardId: "new-card",
		});
	});
});
