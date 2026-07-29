import { describe, expect, test } from "vitest";
import { planAppendCard } from "./append-card";

const input = {
	whiteboardId: "board-1",
	itemId: "item-1",
	shapeId: "shape-1",
	x: 1,
	y: 2,
	w: 576,
	h: 180,
	rotation: 0,
	zIndex: 100,
};

describe("planAppendCard", () => {
	test("returns an existing active placement without writes", () => {
		const plan = planAppendCard(
			{
				card: null,
				existingPlacement: {
					id: "old-item",
					revision: 2,
					cardId: "card-1",
					whiteboardId: "board-1",
					shapeId: "old-shape",
				},
			},
			input,
			{ now: 100, deviceId: "device-1" },
		);
		expect(plan.writes).toEqual([]);
		expect(plan.result).toMatchObject({
			itemId: "old-item",
			shapeId: "old-shape",
			created: false,
		});
	});

	test("creates a placement and updates its card revision conditionally", () => {
		const plan = planAppendCard(
			{
				card: { id: "card-1", revision: 4, activePlacementCount: 1 },
				existingPlacement: null,
			},
			input,
			{ now: 100, deviceId: "device-1" },
		);
		expect(plan.writes).toEqual([
			expect.objectContaining({
				entity: "boardItem",
				id: "item-1",
			}),
			expect.objectContaining({
				entity: "card",
				id: "card-1",
				expectedRevision: 4,
				value: expect.objectContaining({ activePlacementCount: 2 }),
			}),
		]);
		expect(plan.result?.created).toBe(true);
	});
});
