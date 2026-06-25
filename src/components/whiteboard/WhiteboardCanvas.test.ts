import { describe, expect, test } from "vitest";
import { itemToShape } from "./WhiteboardCanvas";

describe("itemToShape", () => {
	test("uses a hydrated height floor for markdown cards", () => {
		const shape = itemToShape({
			_id: "item-1",
			kind: "card",
			cardId: "card-1",
			childWhiteboardId: null,
			shapeId: "shape:card",
			x: 20,
			y: 40,
			w: 320,
			h: 64,
			rotation: 0,
			zIndex: 2,
			card: {
				_id: "card-1",
				content: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "A".repeat(600) }],
						},
					],
				},
				derivedTitle: "Card",
				version: 1,
			},
			childWhiteboard: null,
		} as never);

		expect(shape.type).toBe("markdown-card");
		expect(shape.props.h).toBeGreaterThan(64);
	});

	test("leaves non-markdown board items on their persisted height", () => {
		const shape = itemToShape({
			_id: "item-2",
			kind: "subwhiteboard",
			cardId: null,
			childWhiteboardId: "wb-1",
			shapeId: "shape:sub",
			x: 20,
			y: 40,
			w: 220,
			h: 84,
			rotation: 0,
			zIndex: 2,
			card: null,
			childWhiteboard: {
				_id: "wb-1",
				title: "Nested",
				depth: 2,
				cardCount: 3,
				childWhiteboardCount: 1,
			},
		} as never);

		expect(shape.type).toBe("subwhiteboard-link");
		expect(shape.props.h).toBe(84);
	});
});
