import { describe, expect, test } from "vitest";
import { collectReferenceIds } from "../canvas/derive/references";
import { deriveCardMetadata } from "./card-content";
import {
	cardContentToTextWithReferences,
	referencedCardIds,
	textToCardContentWithReferences,
} from "./card-reference-text";

describe("card reference text", () => {
	test("round trips a reference inside a sentence", () => {
		const text =
			"Rate limiting\nThe cap is 600/min, per [the sync worker notes](contextboard:card/card-99).";
		const content = textToCardContentWithReferences(text);
		expect(cardContentToTextWithReferences(content)).toBe(text);
	});

	// This is the assertion that matters: planReferences walks the document for
	// `cardId`, so a link mark that lacks it produces no backlink at all.
	test("produces link marks that the reference planner can find", () => {
		const content = textToCardContentWithReferences(
			"Title\nSee [notes](contextboard:card/card-1) and [more](contextboard:card/card-2).",
		);
		expect([...collectReferenceIds(content, "cardId")].sort()).toEqual([
			"card-1",
			"card-2",
		]);
	});

	// The reference contributes its label, not its syntax, to the searchable
	// text. `deriveCardMetadata` separates inline runs with a space, which is
	// pre-existing behaviour shared with every other mark (bold, links, math).
	test("keeps the reference label as the visible text", () => {
		const content = textToCardContentWithReferences(
			"Title\nBacked by [Shannon 1948](contextboard:card/card-7).",
		);
		const { plainText, preview } = deriveCardMetadata(content);
		expect(plainText).toContain("Shannon 1948");
		expect(plainText).not.toContain("contextboard:card");
		expect(preview).not.toContain("contextboard:card");
	});

	test("falls back to the card id when no label is given", () => {
		const content = textToCardContentWithReferences(
			"Title\nSee [](contextboard:card/card-3).",
		);
		expect(cardContentToTextWithReferences(content)).toBe(
			"Title\nSee [card-3](contextboard:card/card-3).",
		);
	});

	test("leaves ordinary markdown links untouched", () => {
		const text = "Title\nSee [the RFC](https://example.com/rfc).";
		const content = textToCardContentWithReferences(text);
		expect([...collectReferenceIds(content, "cardId")]).toEqual([]);
		expect(cardContentToTextWithReferences(content)).toBe(text);
	});

	test("uses the first line as the derived title", () => {
		const content = textToCardContentWithReferences(
			"Cache invalidation\nBody text.",
		);
		expect(deriveCardMetadata(content).derivedTitle).toBe("Cache invalidation");
	});

	test("reads references written by the editor's own href form", () => {
		const content = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Prior work",
							marks: [{ type: "link", attrs: { href: "/cards/card-42" } }],
						},
					],
				},
			],
		};
		expect(cardContentToTextWithReferences(content)).toBe(
			"[Prior work](contextboard:card/card-42)",
		);
	});

	test("lists referenced ids without duplicates", () => {
		expect(
			referencedCardIds(
				"[a](contextboard:card/x) [b](contextboard:card/y) [c](contextboard:card/x)",
			),
		).toEqual(["x", "y"]);
	});

	test("handles text with no references at all", () => {
		const text = "Plain title\nJust prose.\n\nAnother paragraph.";
		const content = textToCardContentWithReferences(text);
		expect([...collectReferenceIds(content, "cardId")]).toEqual([]);
		expect(cardContentToTextWithReferences(content)).toBe(
			"Plain title\nJust prose.\n\nAnother paragraph.",
		);
	});
});
