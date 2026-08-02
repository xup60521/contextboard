import { describe, expect, test } from "vitest";
import { textToCardContentWithReferences } from "./card-reference-text";
import { estimateCardHeight } from "./estimate-card-height";

const WIDTH = 576;

const estimate = (text: string) =>
	estimateCardHeight(textToCardContentWithReferences(text), WIDTH);

describe("estimate card height", () => {
	test("a one-line card stays close to the minimum", () => {
		const height = estimate("Rate limiting");
		expect(height).toBeGreaterThanOrEqual(96);
		expect(height).toBeLessThan(180);
	});

	test("more paragraphs make a taller card", () => {
		const body = "\nThe sync worker caps writes at 600 per minute.";
		const short = estimate(`Rate limiting${body}`);
		const long = estimate(`Rate limiting${body.repeat(6)}`);
		expect(long).toBeGreaterThan(short);
		// Six times the body is not six times the card: the title and the card's
		// own chrome are fixed overhead.
		expect(long).toBeLessThan(short * 6);
	});

	test("a long paragraph wraps onto several lines", () => {
		const oneLine = estimate("Title\nshort");
		const wrapped = estimate(`Title\n${"word ".repeat(80).trim()}`);
		expect(wrapped).toBeGreaterThan(oneLine + 100);
	});

	test("a narrower card wraps the same text into more lines", () => {
		const content = textToCardContentWithReferences(
			`Title\n${"word ".repeat(60).trim()}`,
		);
		expect(estimateCardHeight(content, 280)).toBeGreaterThan(
			estimateCardHeight(content, 576),
		);
	});

	test("code blocks count source lines instead of wrapping", () => {
		const code = ["Title", "", "```", "a", "b", "c", "d", "```"].join("\n");
		const height = estimate(code);
		const single = estimate(["Title", "", "```", "a", "```"].join("\n"));
		// Four short lines cost three extra rows; wrapping would have made them one.
		expect(height).toBeGreaterThan(single);
		expect(height - single).toBeLessThan(120);
	});

	test("a bullet list grows with its items", () => {
		const two = estimate("Title\n\n- one\n- two");
		const six = estimate("Title\n\n- one\n- two\n- three\n- four\n- five\n- six");
		expect(six).toBeGreaterThan(two);
	});

	test("clamps an enormous document rather than returning a wall", () => {
		expect(estimate(`Title\n${"paragraph\n".repeat(500)}`)).toBe(1200);
	});

	test("falls back to the minimum for content that is not a document", () => {
		expect(estimateCardHeight(null, WIDTH)).toBe(96);
		expect(estimateCardHeight("not a doc", WIDTH)).toBe(96);
		expect(estimateCardHeight({ type: "doc", content: [] }, WIDTH)).toBe(96);
	});

	test("survives a nonsense width", () => {
		const content = textToCardContentWithReferences("Title\nbody");
		expect(estimateCardHeight(content, Number.NaN)).toBeGreaterThanOrEqual(96);
		expect(estimateCardHeight(content, 0)).toBeGreaterThanOrEqual(96);
	});
});
