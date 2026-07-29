/**
 * Card content derivation shared by every storage backend.
 *
 * The Web IndexedDB adapter and the Desktop SQLite adapter must derive
 * `derivedTitle`, `plainText` and `preview` identically, otherwise the same
 * card would render differently per platform. The rules mirror the original
 * Web `metadata()` implementation in `apps/web/src/integrations/local`.
 */

export const DEFAULT_CARD_TITLE = "Untitled card";

export const DEFAULT_CARD_CONTENT = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "New card" }],
		},
	],
};

const BLOCK_TYPES = new Set([
	"heading",
	"paragraph",
	"listItem",
	"blockquote",
	"codeBlock",
	"tableCell",
	"tableHeader",
]);

function collectTextRows(value: unknown, rows: string[]) {
	if (!value || typeof value !== "object") return;
	const node = value as {
		type?: unknown;
		text?: unknown;
		attrs?: Record<string, unknown>;
		content?: unknown;
	};
	if (node.type === "text" && typeof node.text === "string") {
		rows.push(node.text);
		return;
	}
	if (node.type === "inlineMath" || node.type === "blockMath") {
		if (typeof node.attrs?.latex === "string") rows.push(node.attrs.latex);
		return;
	}
	if (!Array.isArray(node.content)) return;
	const children: string[] = [];
	for (const child of node.content) collectTextRows(child, children);
	if (typeof node.type === "string" && BLOCK_TYPES.has(node.type)) {
		rows.push(children.join(" "));
	} else {
		rows.push(...children);
	}
}

export type CardMetadata = {
	plainText: string;
	derivedTitle: string;
	preview: string;
};

export function deriveCardMetadata(content: unknown): CardMetadata {
	const rows: string[] = [];
	collectTextRows(content, rows);
	const normalizedRows = rows
		.map((row) => row.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	const plainText = normalizedRows.join("\n").slice(0, 10_000).trim();
	return {
		plainText,
		derivedTitle: normalizedRows[0]?.slice(0, 120) || DEFAULT_CARD_TITLE,
		preview: plainText.slice(0, 400),
	};
}

/** Renders a card document as the plain text the shared editor edits. */
export function cardContentToText(content: unknown): string {
	const rows: string[] = [];
	collectTextRows(content, rows);
	return rows.map((row) => row.replace(/[ \t]+/g, " ").trim()).join("\n");
}

/** Builds a document from plain text: first line heading, rest paragraphs. */
export function textToCardContent(text: string): unknown {
	const lines = text.split("\n");
	const nodes = lines.map((line, index) => {
		const trimmed = line.trim();
		const children = trimmed
			? { content: [{ type: "text", text: trimmed }] }
			: {};
		return index === 0
			? { type: "heading", attrs: { level: 1 }, ...children }
			: { type: "paragraph", ...children };
	});
	return { type: "doc", content: nodes };
}
