/**
 * Plain-text marshalling for card references.
 *
 * Cards are stored as ProseMirror documents, and a reference to another card is
 * an ordinary `link` mark carrying `cardId` / `cardLabelMode` / `resolvedTitle`
 * (see `packages/editor/src/card-reference/card-link.ts`). Programmatic callers
 * — the MCP agent gateway — read and write plain text, so this module round
 * trips those marks through a compact `[label](contextboard:card/<id>)` syntax.
 *
 * Getting this right is what makes references work end to end: `planReferences`
 * derives `cardReference` rows from whatever link marks are in the document, so
 * a correctly marshalled write produces real backlinks with no extra call, and
 * a badly marshalled one silently produces none.
 */

export const CARD_REFERENCE_SCHEME = "contextboard:card/";
const CARD_PATH_PREFIX = "/cards/";

/** Matches `[label](contextboard:card/<id>)`, capturing label and id. */
const REFERENCE_PATTERN = /\[([^\]]*)\]\(contextboard:card\/([^)\s]+)\)/g;

type TextNode = {
	type: "text";
	text: string;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function cardLinkMark(cardId: string, label: string) {
	return {
		type: "link",
		attrs: {
			href: `${CARD_PATH_PREFIX}${cardId}`,
			cardId,
			// `custom` preserves the agent's wording; `auto` would let the app
			// relabel the link with the target's current title.
			cardLabelMode: "custom",
			resolvedTitle: label,
		},
	};
}

/** Splits one line of agent text into text nodes, linking any references. */
function inlineNodes(line: string): TextNode[] {
	const nodes: TextNode[] = [];
	let cursor = 0;
	REFERENCE_PATTERN.lastIndex = 0;
	let match = REFERENCE_PATTERN.exec(line);
	while (match) {
		const [raw, rawLabel, cardId] = match;
		if (match.index > cursor) {
			nodes.push({ type: "text", text: line.slice(cursor, match.index) });
		}
		const label = rawLabel.trim() || cardId;
		nodes.push({
			type: "text",
			text: label,
			marks: [cardLinkMark(cardId, label)],
		});
		cursor = match.index + raw.length;
		match = REFERENCE_PATTERN.exec(line);
	}
	if (cursor < line.length) {
		nodes.push({ type: "text", text: line.slice(cursor) });
	}
	return nodes;
}

/**
 * Builds a card document from plain text, preserving card references.
 *
 * Mirrors `textToCardContent`: the first line becomes the heading (and so the
 * card's derived title), remaining lines become paragraphs.
 */
export function textToCardContentWithReferences(text: string): unknown {
	const lines = text.split("\n");
	const nodes = lines.map((line, index) => {
		const trimmed = line.trim();
		const children = trimmed ? { content: inlineNodes(trimmed) } : {};
		return index === 0
			? { type: "heading", attrs: { level: 1 }, ...children }
			: { type: "paragraph", ...children };
	});
	return { type: "doc", content: nodes };
}

const BLOCK_TYPES = new Set([
	"heading",
	"paragraph",
	"listItem",
	"blockquote",
	"codeBlock",
	"tableCell",
	"tableHeader",
]);

function readCardId(node: TextNode): string | null {
	for (const mark of node.marks ?? []) {
		if (mark.type !== "link") continue;
		const attrs = mark.attrs ?? {};
		const cardId = attrs.cardId;
		if (typeof cardId === "string" && cardId) return cardId;
		// Older documents may carry only the href.
		const href = attrs.href;
		if (typeof href === "string" && href.startsWith(CARD_PATH_PREFIX)) {
			const id = href.slice(CARD_PATH_PREFIX.length);
			if (id && !/[/#?]/.test(id)) return id;
		}
	}
	return null;
}

function collectRows(value: unknown, rows: string[]) {
	if (!value || typeof value !== "object") return;
	const node = value as {
		type?: unknown;
		text?: unknown;
		attrs?: Record<string, unknown>;
		content?: unknown;
		marks?: TextNode["marks"];
	};
	if (node.type === "text" && typeof node.text === "string") {
		const cardId = readCardId(node as TextNode);
		rows.push(
			cardId ? `[${node.text}](${CARD_REFERENCE_SCHEME}${cardId})` : node.text,
		);
		return;
	}
	if (node.type === "inlineMath" || node.type === "blockMath") {
		if (typeof node.attrs?.latex === "string") rows.push(node.attrs.latex);
		return;
	}
	if (!Array.isArray(node.content)) {
		// An empty block is a blank line. Dropping it would make the text the
		// agent reads back differ from the text it wrote.
		if (typeof node.type === "string" && BLOCK_TYPES.has(node.type)) {
			rows.push("");
		}
		return;
	}
	const children: string[] = [];
	for (const child of node.content) collectRows(child, children);
	if (typeof node.type === "string" && BLOCK_TYPES.has(node.type)) {
		// Inline runs join without separators so a reference stays inside its
		// sentence rather than being pushed onto its own line.
		rows.push(children.join(""));
	} else {
		rows.push(...children);
	}
}

/** Renders a card document as plain text with references in compact form. */
export function cardContentToTextWithReferences(content: unknown): string {
	const rows: string[] = [];
	collectRows(content, rows);
	return rows.map((row) => row.replace(/[ \t]+/g, " ").trim()).join("\n");
}

/** Card ids referenced by a block of agent text, in order of first appearance. */
export function referencedCardIds(text: string): string[] {
	const ids = new Set<string>();
	REFERENCE_PATTERN.lastIndex = 0;
	let match = REFERENCE_PATTERN.exec(text);
	while (match) {
		ids.add(match[2]);
		match = REFERENCE_PATTERN.exec(text);
	}
	return [...ids];
}
