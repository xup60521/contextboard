import { describe, expect, test } from "vitest";
import {
	getHydratedMarkdownCardHeight,
	resolveMarkdownCardHeight,
} from "./markdown-card-sizing";

describe("markdown card sizing", () => {
	test("preserves current height when the card is hidden", () => {
		expect(
			resolveMarkdownCardHeight({
				currentHeight: 420,
				measuredScrollHeight: 820,
				headerHeight: 28,
				minHeight: 96,
				isContentReady: true,
				isVisible: false,
			}),
		).toBe(420);
	});

	test("preserves current height before the content is ready", () => {
		expect(
			resolveMarkdownCardHeight({
				currentHeight: 420,
				measuredScrollHeight: 820,
				headerHeight: 28,
				minHeight: 96,
				isContentReady: false,
				isVisible: true,
			}),
		).toBe(420);
	});

	test("allows ready visible cards to grow", () => {
		expect(
			resolveMarkdownCardHeight({
				currentHeight: 96,
				measuredScrollHeight: 520,
				headerHeight: 28,
				minHeight: 96,
				isContentReady: true,
				isVisible: true,
			}),
		).toBe(520);
	});

	test("allows ready visible cards to shrink", () => {
		expect(
			resolveMarkdownCardHeight({
				currentHeight: 520,
				measuredScrollHeight: 132,
				headerHeight: 28,
				minHeight: 96,
				isContentReady: true,
				isVisible: true,
			}),
		).toBe(132);
	});

	test("hydrates with the persisted height when above the minimum", () => {
		expect(
			getHydratedMarkdownCardHeight({
				serverHeight: 240,
				minHeight: 96,
			}),
		).toBe(240);
	});

	test("clamps the hydrated height to the minimum", () => {
		expect(
			getHydratedMarkdownCardHeight({
				serverHeight: 64,
				minHeight: 96,
			}),
		).toBe(96);
	});
});
