import { describe, expect, test } from "vitest";
import { hasRelationAffectingChange } from "./useCardRelationSync";

const empty = () => ({ added: {}, updated: {}, removed: {} });

describe("hasRelationAffectingChange", () => {
	test("ignores card text, height, ink, and unrelated shape changes", () => {
		expect(
			hasRelationAffectingChange({
				...empty(),
				updated: {
					"shape:card": [
						{ typeName: "shape", type: "markdown-card", props: { h: 100 } },
						{ typeName: "shape", type: "markdown-card", props: { h: 120 } },
					],
					"shape:ink": [
						{ typeName: "shape", type: "draw" },
						{ typeName: "shape", type: "draw" },
					],
				},
			}),
		).toBe(false);
	});

	test.each([
		{ typeName: "shape", type: "arrow" },
		{ typeName: "binding", type: "arrow" },
	])("reacts to an affected $type record", (record) => {
		expect(
			hasRelationAffectingChange({
				...empty(),
				added: { affected: record },
			}),
		).toBe(true);
	});

	test("reacts when a bound card endpoint is added or removed", () => {
		const card = { typeName: "shape", type: "markdown-card" };
		expect(
			hasRelationAffectingChange({ ...empty(), removed: { card } }),
		).toBe(true);
	});
});
