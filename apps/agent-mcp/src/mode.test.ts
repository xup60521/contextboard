import { describe, expect, test } from "vitest";
import { resolveAgentMode } from "./index";

describe("agent mode", () => {
	test("defaults to the live bridge", () => {
		expect(resolveAgentMode({})).toBe("bridge");
	});

	test("accepts the explicit replica mode", () => {
		expect(resolveAgentMode({ CONTEXTBOARD_AGENT_MODE: " replica " })).toBe(
			"replica",
		);
	});

	test("rejects unknown modes instead of falling back", () => {
		expect(() =>
			resolveAgentMode({ CONTEXTBOARD_AGENT_MODE: "automatic" }),
		).toThrow(/bridge or replica/);
	});
});
