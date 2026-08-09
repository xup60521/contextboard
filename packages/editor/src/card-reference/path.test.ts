import { describe, expect, test } from "vitest";
import { parseWhiteboardIdFromHref, whiteboardHref } from "./path";

describe("whiteboard reference paths", () => {
	test("round trips a whiteboard id", () => {
		expect(whiteboardHref("board-1")).toBe("/whiteboard/board-1");
		expect(parseWhiteboardIdFromHref("/whiteboard/board-1")).toBe("board-1");
	});

	test.each([null, undefined, "", "/whiteboard/", "/whiteboard/a/b", "/whiteboard/a?x=1", "/cards/a"])("rejects malformed href %s", (href) => {
		expect(parseWhiteboardIdFromHref(href)).toBeNull();
	});
});
