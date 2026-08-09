import { describe, expect, test } from "vitest";
import { isSubwhiteboardEnterShortcut } from "./whiteboard-canvas-helpers";

const baseEvent = {
	key: "Enter",
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	metaKey: false,
	repeat: false,
};

describe("isSubwhiteboardEnterShortcut", () => {
	test("matches a plain Enter keypress", () => {
		expect(isSubwhiteboardEnterShortcut(baseEvent)).toBe(true);
	});

	test("rejects other keys", () => {
		expect(isSubwhiteboardEnterShortcut({ ...baseEvent, key: "Escape" })).toBe(
			false,
		);
	});

	test.each(["ctrlKey", "altKey", "shiftKey", "metaKey"] as const)(
		"rejects Enter with %s held",
		(modifier) => {
			expect(
				isSubwhiteboardEnterShortcut({ ...baseEvent, [modifier]: true }),
			).toBe(false);
		},
	);

	test("rejects repeated keydown events", () => {
		expect(isSubwhiteboardEnterShortcut({ ...baseEvent, repeat: true })).toBe(
			false,
		);
	});
});
