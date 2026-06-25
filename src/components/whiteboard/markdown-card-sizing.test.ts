import { describe, expect, test } from "vitest";
import {
	estimateMarkdownCardHeight,
	getHydratedMarkdownCardHeight,
	resolveMarkdownCardHeight,
} from "./markdown-card-sizing";

function createDoc(...blocks: unknown[]) {
	return JSON.stringify({
		type: "doc",
		content: blocks,
	});
}

describe("markdown card sizing", () => {
	test("keeps short content near the minimum height", () => {
		const height = estimateMarkdownCardHeight(
			createDoc({
				type: "paragraph",
				content: [{ type: "text", text: "Short card" }],
			}),
			360,
			96,
		);

		expect(height).toBeGreaterThanOrEqual(96);
		expect(height).toBeLessThanOrEqual(130);
	});

	test("estimates larger heights for longer multi-block content", () => {
		const longHeight = estimateMarkdownCardHeight(
			createDoc(
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "Large card" }],
				},
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "A".repeat(900),
						},
					],
				},
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "B".repeat(900),
						},
					],
				},
			),
			360,
			96,
		);

		expect(longHeight).toBeGreaterThan(500);
	});

	test("estimates narrower cards as taller than wider cards", () => {
		const content = createDoc({
			type: "paragraph",
			content: [{ type: "text", text: "C".repeat(400) }],
		});

		const narrowHeight = estimateMarkdownCardHeight(content, 260, 96);
		const wideHeight = estimateMarkdownCardHeight(content, 560, 96);

		expect(narrowHeight).toBeGreaterThan(wideHeight);
	});

	test("falls back to the minimum height for invalid content", () => {
		expect(estimateMarkdownCardHeight("not json", 360, 96)).toBe(96);
	});

	test("preserves current height when the card is hidden", () => {
		expect(
			resolveMarkdownCardHeight({
				currentHeight: 420,
				measuredScrollHeight: 820,
				headerHeight: 28,
				minHeight: 96,
				isEditorReady: true,
				isVisible: false,
			}),
		).toBe(420);
	});

	test("preserves current height before the editor is ready", () => {
		expect(
			resolveMarkdownCardHeight({
				currentHeight: 420,
				measuredScrollHeight: 820,
				headerHeight: 28,
				minHeight: 96,
				isEditorReady: false,
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
				isEditorReady: true,
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
				isEditorReady: true,
				isVisible: true,
			}),
		).toBe(132);
	});

	test("uses the larger of the persisted height and the unloaded estimate for hydration", () => {
		const content = createDoc({
			type: "paragraph",
			content: [{ type: "text", text: "D".repeat(600) }],
		});

		expect(
			getHydratedMarkdownCardHeight({
				content,
				width: 320,
				serverHeight: 64,
				minHeight: 96,
			}),
		).toBeGreaterThan(64);
	});

	test("keeps the persisted height when it is already larger than the unloaded estimate", () => {
		const content = createDoc({
			type: "paragraph",
			content: [{ type: "text", text: "Short" }],
		});

		expect(
			getHydratedMarkdownCardHeight({
				content,
				width: 360,
				serverHeight: 240,
				minHeight: 96,
			}),
		).toBe(240);
	});
});
