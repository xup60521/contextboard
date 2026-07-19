import { describe, expect, test } from "vitest";
import {
	collectCardReferenceIds,
	normalizeCardReferences,
	parseCardIdFromHref,
	resolveCardReferenceTitles,
} from "./cardReferences";

type Attrs = Record<string, unknown>;

function cardRef(text: string, attrs: Attrs) {
	return { type: "text", text, marks: [{ type: "link", attrs }] };
}

function doc(...nodes: unknown[]) {
	return { type: "doc", content: [{ type: "paragraph", content: nodes }] };
}

function firstInline(content: unknown) {
	const out = content as {
		content: { content: { text: string; marks: { attrs: Attrs }[] }[] }[];
	};
	return out.content[0].content[0];
}

describe("parseCardIdFromHref", () => {
	test("accepts canonical card hrefs", () => {
		expect(parseCardIdFromHref("/cards/abc123")).toBe("abc123");
	});

	test("rejects external and malformed hrefs", () => {
		expect(parseCardIdFromHref("https://example.com")).toBeNull();
		expect(parseCardIdFromHref("/cards/")).toBeNull();
		expect(parseCardIdFromHref("/cards/a/b")).toBeNull();
		expect(parseCardIdFromHref("/cards/a?x=1")).toBeNull();
		expect(parseCardIdFromHref(undefined)).toBeNull();
	});
});

describe("collectCardReferenceIds", () => {
	test("collects ids from explicit attrs and from hrefs", () => {
		const content = doc(
			cardRef("A", { href: "/cards/c1", cardId: "c1" }),
			cardRef("B", { href: "/cards/c2" }),
			{
				type: "text",
				text: "external",
				marks: [{ type: "link", attrs: { href: "https://example.com" } }],
			},
		);
		expect(collectCardReferenceIds(content).sort()).toEqual(["c1", "c2"]);
	});
});

describe("normalizeCardReferences (save-time)", () => {
	test("keeps an unedited auto label tracking the current title", () => {
		const content = doc(
			cardRef("Old Title", {
				href: "/cards/c1",
				cardId: "c1",
				cardLabelMode: "auto",
				resolvedTitle: "Old Title",
			}),
		);
		const out = normalizeCardReferences(content, new Map([["c1", "New Title"]]));
		const node = firstInline(out);
		expect(node.text).toBe("New Title");
		expect(node.marks[0].attrs.cardLabelMode).toBe("auto");
		expect(node.marks[0].attrs.resolvedTitle).toBe("New Title");
		expect(node.marks[0].attrs.href).toBe("/cards/c1");
	});

	test("flips an edited auto label to custom", () => {
		const content = doc(
			cardRef("My Custom Label", {
				href: "/cards/c1",
				cardId: "c1",
				cardLabelMode: "auto",
				resolvedTitle: "Old Title",
			}),
		);
		const out = normalizeCardReferences(content, new Map([["c1", "New Title"]]));
		const node = firstInline(out);
		expect(node.text).toBe("My Custom Label");
		expect(node.marks[0].attrs.cardLabelMode).toBe("custom");
	});

	test("canonicalizes href and infers cardId for href-only custom refs", () => {
		const content = doc(
			cardRef("Label", { href: "/cards/c2", cardLabelMode: "custom" }),
		);
		const out = normalizeCardReferences(content, new Map([["c2", "Title"]]));
		const node = firstInline(out);
		expect(node.text).toBe("Label");
		expect(node.marks[0].attrs.cardId).toBe("c2");
		expect(node.marks[0].attrs.href).toBe("/cards/c2");
		expect(node.marks[0].attrs.cardLabelMode).toBe("custom");
	});
});

describe("resolveCardReferenceTitles (read-time)", () => {
	test("replaces auto labels with the current title", () => {
		const content = doc(
			cardRef("Stale", {
				href: "/cards/c1",
				cardId: "c1",
				cardLabelMode: "auto",
				resolvedTitle: "Stale",
			}),
		);
		const out = resolveCardReferenceTitles(content, new Map([["c1", "Fresh"]]));
		expect(firstInline(out).text).toBe("Fresh");
	});

	test("leaves custom labels untouched", () => {
		const content = doc(
			cardRef("Pinned", {
				href: "/cards/c1",
				cardId: "c1",
				cardLabelMode: "custom",
				resolvedTitle: "Old",
			}),
		);
		const out = resolveCardReferenceTitles(content, new Map([["c1", "Fresh"]]));
		expect(firstInline(out).text).toBe("Pinned");
	});
});
