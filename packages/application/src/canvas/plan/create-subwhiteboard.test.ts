import { describe, expect, test } from "vitest";
import { planCreateSubwhiteboard } from "./create-subwhiteboard";

describe("planCreateSubwhiteboard", () => {
	test("preserves the existing sortKey and pathKey formula", () => {
		const plan = planCreateSubwhiteboard(
			{
				parent: {
					id: "parent",
					ancestorIds: ["root"],
					depth: 1,
					pathKey: "root/parent",
				},
				activeChildCount: 12,
			},
			{
				boardId: "child",
				itemId: "item",
				shapeId: "shape",
				x: 1,
				y: 2,
				w: 320,
				h: 180,
				rotation: 0,
			},
			{ now: 36, deviceId: "device" },
		);
		expect(plan.writes[0]).toMatchObject({
			entity: "whiteboard",
			value: {
				parentWhiteboardId: "parent",
				ancestorIds: ["root", "parent"],
				depth: 2,
				sortKey: "0000000012-10",
				pathKey: "root/parent/0000000012-10",
			},
		});
		expect(plan.result).toEqual({
			itemId: "item",
			childWhiteboardId: "child",
		});
	});
});
