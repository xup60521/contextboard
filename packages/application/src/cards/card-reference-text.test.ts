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

// `update_card` replaces the whole document, so anything that renders but does
// not parse back is data an agent would destroy just by editing a card. Each of
// these asserts the exact text survives a full round trip.
describe("markdown round trips", () => {
	const roundTrip = (text: string) =>
		cardContentToTextWithReferences(textToCardContentWithReferences(text));

	test.each([
		["headings", "Title\n## Section\n### Deeper\nBody."],
		["bullet list", "Title\n- one\n- two\n- three"],
		["ordered list", "Title\n1. first\n2. second\n3. third"],
		["blockquote", "Title\n> quoted line\n> second line"],
		["horizontal rule", "Title\nAbove.\n---\nBelow."],
		["block math", "Title\n$$E = mc^2$$"],
		["inline math", "Title\nThe cap is $n \\log n$ overall."],
		["fenced code", "Title\n```ts\nconst x = 1;\n```"],
		["unfenced code", "Title\n```\nplain\n```"],
		[
			"table",
			"Title\n| Name | Role |\n| --- | --- |\n| Ada | Author |\n| Alan | Editor |",
		],
		["nested bullets", "Title\n- outer\n  - inner\n  - inner two\n- outer two"],
		["paragraphs and blanks", "Title\nOne.\n\nTwo.\n\nThree."],
	])("preserves %s", (_label, text) => {
		expect(roundTrip(text)).toBe(text);
	});

	test("keeps references inside a list item", () => {
		const text = "Title\n- see [notes](contextboard:card/card-1)\n- plain";
		expect(roundTrip(text)).toBe(text);
		expect(referencedCardIds(text)).toEqual(["card-1"]);
	});

	test("keeps references inside a table cell", () => {
		const text =
			"Title\n| Source | Note |\n| --- | --- |\n| [Shannon](contextboard:card/card-7) | 1948 |";
		expect(roundTrip(text)).toBe(text);
		expect([
			...collectReferenceIds(textToCardContentWithReferences(text), "cardId"),
		]).toEqual(["card-7"]);
	});

	test("does not read a reference inside a code block as a link", () => {
		const text = "Title\n```\n[x](contextboard:card/card-9)\n```";
		const content = textToCardContentWithReferences(text);
		expect([...collectReferenceIds(content, "cardId")]).toEqual([]);
		expect(cardContentToTextWithReferences(content)).toBe(text);
	});

	test("escapes a pipe inside a table cell", () => {
		const text = "Title\n| Expr |\n| --- |\n| a \\| b |";
		expect(roundTrip(text)).toBe(text);
	});

	test("normalizes a marked-up title to the bare form", () => {
		// `# Title` and `Title` describe the same card, so both settle on the
		// bare form the tools document.
		expect(roundTrip("# Title\nBody.")).toBe("Title\nBody.");
		expect(roundTrip(roundTrip("# Title\nBody."))).toBe("Title\nBody.");
	});

	test("survives a document combining every supported block", () => {
		const text = [
			"Release notes",
			"## Summary",
			"Ships [the sync fix](contextboard:card/card-3).",
			"",
			"- bullet",
			"  - nested",
			"1. step one",
			"2. step two",
			"> a caveat",
			"```sh",
			"bun run test",
			"```",
			"| Field | Value |",
			"| --- | --- |",
			"| Size | $O(n)$ |",
			"---",
			"$$\\sum_{i=0}^{n} i$$",
		].join("\n");
		expect(roundTrip(text)).toBe(text);
	});
});
