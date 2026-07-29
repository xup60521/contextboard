import { describe, expect, test } from "vitest";
import { planCreateCardItem } from "./create-card-item";

describe("planCreateCardItem", () => {
	test("creates a placed card and board item as one write plan", () => {
		const content = {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "Title" }] }],
		};
		const plan = planCreateCardItem(
			{
				whiteboardId: "board",
				cardId: "card",
				itemId: "item",
				shapeId: "shape",
				content,
				x: 1,
				y: 2,
				w: 576,
				h: 180,
				rotation: 0,
			},
			{ now: 100, deviceId: "device" },
		);
		expect(plan.writes.map(({ entity, id }) => [entity, id])).toEqual([
			["card", "card"],
			["boardItem", "item"],
		]);
		expect(plan.writes[0]?.value).toMatchObject({
			activePlacementCount: 1,
			derivedTitle: "Title",
		});
	});
});
