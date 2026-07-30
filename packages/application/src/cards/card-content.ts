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

/**
 * Normalizes a card document that may have been serialized on the way in.
 *
 * The canvas keeps a card's document as a JSON *string* in its tldraw shape
 * props, and hands that string over when a shape is pasted or duplicated. A
 * card row must hold the parsed document: storing the string instead makes the
 * card render blank, because the editor then receives a string where a
 * ProseMirror document is expected and treats it as HTML.
 */
export function normalizeCardContent(value: unknown): unknown {
	if (typeof value !== "string") return value ?? DEFAULT_CARD_CONTENT;
	if (!value) return DEFAULT_CARD_CONTENT;
	try {
		const parsed = JSON.parse(value) as { type?: unknown };
		return parsed && typeof parsed === "object" && parsed.type === "doc"
			? parsed
			: DEFAULT_CARD_CONTENT;
	} catch {
		return DEFAULT_CARD_CONTENT;
	}
}
