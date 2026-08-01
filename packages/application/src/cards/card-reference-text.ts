/**
 * Markdown marshalling for card documents.
 *
 * Cards are stored as ProseMirror documents, and a reference to another card is
 * an ordinary `link` mark carrying `cardId` / `cardLabelMode` / `resolvedTitle`
 * (see `packages/editor/src/card-reference/card-link.ts`). Programmatic callers
 * — the MCP agent gateway — read and write plain text, so this module round
 * trips those documents through markdown.
 *
 * Both directions have to cover the same subset. `update_card` replaces the
 * whole document, so anything this module can render but not parse would be
 * silently destroyed the first time an agent edited a card that used it: read a
 * card with a table, write it back, lose the table. The round-trip tests in
 * `card-reference-text.test.ts` are what keep the two halves honest.
 *
 * Supported: headings, paragraphs, bullet and ordered lists (including nesting),
 * blockquotes, fenced code, pipe tables, horizontal rules, and inline or block
 * math. The first line is the card's title and is written without a leading
 * `#`, though one is accepted and normalized away.
 */

export const CARD_REFERENCE_SCHEME = "contextboard:card/";
const CARD_PATH_PREFIX = "/cards/";

/** Matches `[label](contextboard:card/<id>)`, capturing label and id. */
const REFERENCE_PATTERN = /\[([^\]]*)\]\(contextboard:card\/([^)\s]+)\)/g;
/** Matches `$latex$`, rejecting `$$` so block math is not caught here. */
const INLINE_MATH_PATTERN = /\$([^$\n]+)\$/g;

type Mark = { type: string; attrs?: Record<string, unknown> };

type Node = {
	type?: string;
	text?: string;
	attrs?: Record<string, unknown>;
	content?: Node[];
	marks?: Mark[];
};

function cardLinkMark(cardId: string, label: string): Mark {
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

// ---------------------------------------------------------------------------
// Text -> document
// ---------------------------------------------------------------------------

/** Splits one line into inline nodes, linking references and math. */
function inlineNodes(line: string): Node[] {
	const nodes: Node[] = [];
	let cursor = 0;

	type Hit = { index: number; length: number; node: Node };
	const hits: Hit[] = [];

	REFERENCE_PATTERN.lastIndex = 0;
	let match = REFERENCE_PATTERN.exec(line);
	while (match) {
		const [raw, rawLabel, cardId] = match;
		const label = rawLabel.trim() || cardId;
		hits.push({
			index: match.index,
			length: raw.length,
			node: { type: "text", text: label, marks: [cardLinkMark(cardId, label)] },
		});
		match = REFERENCE_PATTERN.exec(line);
	}

	INLINE_MATH_PATTERN.lastIndex = 0;
	let math = INLINE_MATH_PATTERN.exec(line);
	while (math) {
		const start = math.index;
		const length = math[0].length;
		// A `$` inside a reference label or url is not math.
		const overlapping = hits.some(
			(hit) => start < hit.index + hit.length && start + length > hit.index,
		);
		if (!overlapping) {
			hits.push({
				index: start,
				length,
				node: { type: "inlineMath", attrs: { latex: math[1] } },
			});
		}
		math = INLINE_MATH_PATTERN.exec(line);
	}

	hits.sort((a, b) => a.index - b.index);
	for (const hit of hits) {
		if (hit.index < cursor) continue;
		if (hit.index > cursor) {
			nodes.push({ type: "text", text: line.slice(cursor, hit.index) });
		}
		nodes.push(hit.node);
		cursor = hit.index + hit.length;
	}
	if (cursor < line.length) {
		nodes.push({ type: "text", text: line.slice(cursor) });
	}
	return nodes;
}

function paragraph(line: string): Node {
	const trimmed = line.trim();
	return trimmed
		? { type: "paragraph", content: inlineNodes(trimmed) }
		: { type: "paragraph" };
}

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BULLET_PATTERN = /^[-*]\s+(.*)$/;
const ORDERED_PATTERN = /^(\d+)[.)]\s+(.*)$/;
const FENCE_PATTERN = /^```(\w*)\s*$/;
const RULE_PATTERN = /^(?:---|\*\*\*|___)$/;
const BLOCK_MATH_PATTERN = /^\$\$(.*)\$\$$/;

function indentOf(line: string): number {
	const match = /^(\s*)/.exec(line);
	return match ? match[1].length : 0;
}

/** Splits a markdown table row into cells, honouring escaped pipes. */
function splitRow(line: string): string[] {
	const cells: string[] = [];
	let current = "";
	let escaped = false;
	const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	for (const char of body) {
		if (escaped) {
			current += char === "|" ? "|" : `\\${char}`;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current.trim());
	return cells;
}

function isTableDivider(line: string): boolean {
	if (!line.includes("-")) return false;
	return splitRow(line).every((cell) => /^:?-{1,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
	return line.trim().startsWith("|");
}

/** Parses a run of lines at one nesting level into block nodes. */
function parseBlocks(lines: string[]): Node[] {
	const nodes: Node[] = [];
	let index = 0;

	while (index < lines.length) {
		const raw = lines[index];
		const line = raw.trim();

		if (line === "") {
			nodes.push({ type: "paragraph" });
			index += 1;
			continue;
		}

		const fence = FENCE_PATTERN.exec(line);
		if (fence) {
			const body: string[] = [];
			index += 1;
			while (index < lines.length && !FENCE_PATTERN.test(lines[index].trim())) {
				body.push(lines[index]);
				index += 1;
			}
			index += 1; // closing fence
			nodes.push({
				type: "codeBlock",
				attrs: { language: fence[1] || null },
				...(body.length
					? { content: [{ type: "text", text: body.join("\n") }] }
					: {}),
			});
			continue;
		}

		const blockMath = BLOCK_MATH_PATTERN.exec(line);
		if (blockMath) {
			nodes.push({ type: "blockMath", attrs: { latex: blockMath[1].trim() } });
			index += 1;
			continue;
		}

		if (RULE_PATTERN.test(line)) {
			nodes.push({ type: "horizontalRule" });
			index += 1;
			continue;
		}

		const heading = HEADING_PATTERN.exec(line);
		if (heading) {
			nodes.push({
				type: "heading",
				attrs: { level: heading[1].length },
				...(heading[2].trim()
					? { content: inlineNodes(heading[2].trim()) }
					: {}),
			});
			index += 1;
			continue;
		}

		if (line.startsWith("> ") || line === ">") {
			const body: string[] = [];
			while (index < lines.length) {
				const candidate = lines[index].trim();
				if (candidate === ">") body.push("");
				else if (candidate.startsWith("> ")) body.push(candidate.slice(2));
				else break;
				index += 1;
			}
			nodes.push({ type: "blockquote", content: parseBlocks(body) });
			continue;
		}

		if (isTableRow(line)) {
			const rows: string[][] = [];
			let hasHeader = false;
			while (index < lines.length && isTableRow(lines[index])) {
				const candidate = lines[index].trim();
				if (isTableDivider(candidate)) {
					hasHeader = rows.length > 0;
					index += 1;
					continue;
				}
				rows.push(splitRow(candidate));
				index += 1;
			}
			nodes.push(buildTable(rows, hasHeader));
			continue;
		}

		const listNode = parseList(lines, index);
		if (listNode) {
			nodes.push(listNode.node);
			index = listNode.next;
			continue;
		}

		nodes.push(paragraph(line));
		index += 1;
	}

	return nodes;
}

function buildTable(rows: string[][], hasHeader: boolean): Node {
	const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
	return {
		type: "table",
		content: rows.map((cells, rowIndex) => ({
			type: "tableRow",
			content: Array.from({ length: width }, (_, cellIndex) => ({
				type: hasHeader && rowIndex === 0 ? "tableHeader" : "tableCell",
				content: [paragraph(cells[cellIndex] ?? "")],
			})),
		})),
	};
}

/** Parses one list, consuming its nested children. */
function parseList(
	lines: string[],
	start: number,
): { node: Node; next: number } | null {
	const baseIndent = indentOf(lines[start]);
	const first = lines[start].trim();
	const bullet = BULLET_PATTERN.exec(first);
	const ordered = ORDERED_PATTERN.exec(first);
	if (!bullet && !ordered) return null;

	const listType = bullet ? "bulletList" : "orderedList";
	const items: Node[] = [];
	let index = start;

	while (index < lines.length) {
		const raw = lines[index];
		if (raw.trim() === "") break;
		const indent = indentOf(raw);
		if (indent < baseIndent) break;
		const text = raw.trim();
		const itemBullet = BULLET_PATTERN.exec(text);
		const itemOrdered = itemBullet ? null : ORDERED_PATTERN.exec(text);
		const body = itemBullet ? itemBullet[1] : itemOrdered?.[2];
		if (body === undefined) break;
		// A different marker at the same indent starts a new list.
		if (indent === baseIndent && Boolean(itemBullet) !== Boolean(bullet)) break;
		if (indent > baseIndent) break;

		index += 1;

		// Gather any deeper-indented lines as this item's children.
		const nested: string[] = [];
		while (index < lines.length && lines[index].trim() !== "") {
			const childIndent = indentOf(lines[index]);
			if (childIndent <= baseIndent) break;
			nested.push(lines[index].slice(baseIndent + 2));
			index += 1;
		}

		items.push({
			type: "listItem",
			content: [paragraph(body), ...parseBlocks(nested)],
		});
	}

	if (items.length === 0) return null;
	const startAttr = ordered ? Number(ordered[1]) : null;
	return {
		node: {
			type: listType,
			...(startAttr !== null && startAttr !== 1
				? { attrs: { start: startAttr } }
				: {}),
			content: items,
		},
		next: index,
	};
}

/**
 * Builds a card document from markdown, preserving card references.
 *
 * The first line becomes the heading, and so the card's derived title.
 */
export function textToCardContentWithReferences(text: string): unknown {
	const lines = text.split("\n");
	const [titleLine = "", ...rest] = lines;
	const title = titleLine.trim().replace(/^#{1,6}\s+/, "");
	const heading: Node = {
		type: "heading",
		attrs: { level: 1 },
		...(title ? { content: inlineNodes(title) } : {}),
	};
	return { type: "doc", content: [heading, ...parseBlocks(rest)] };
}

// ---------------------------------------------------------------------------
// Document -> text
// ---------------------------------------------------------------------------

function readCardId(node: Node): string | null {
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

/** Renders an inline run: text, references and inline math. */
function inlineToText(nodes: Node[] | undefined): string {
	if (!nodes) return "";
	let out = "";
	for (const node of nodes) {
		if (node.type === "text" && typeof node.text === "string") {
			const cardId = readCardId(node);
			out += cardId
				? `[${node.text}](${CARD_REFERENCE_SCHEME}${cardId})`
				: node.text;
			continue;
		}
		if (node.type === "inlineMath") {
			out += `$${String(node.attrs?.latex ?? "")}$`;
			continue;
		}
		if (node.type === "hardBreak") {
			out += " ";
			continue;
		}
		// Unknown inline node: fall back to its children so text is never lost.
		out += inlineToText(node.content);
	}
	return out.replace(/[ \t]+/g, " ").trim();
}

function codeText(node: Node): string {
	return (node.content ?? [])
		.map((child) => (typeof child.text === "string" ? child.text : ""))
		.join("");
}

/** Renders block nodes as markdown lines. */
function blocksToLines(nodes: Node[] | undefined): string[] {
	if (!nodes) return [];
	const lines: string[] = [];

	for (const node of nodes) {
		switch (node.type) {
			case "heading": {
				const level = Number(node.attrs?.level ?? 1);
				const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
				lines.push(`${hashes} ${inlineToText(node.content)}`.trim());
				break;
			}
			case "paragraph":
				lines.push(inlineToText(node.content));
				break;
			case "codeBlock": {
				const language = node.attrs?.language;
				lines.push(`\`\`\`${typeof language === "string" ? language : ""}`);
				lines.push(...codeText(node).split("\n"));
				lines.push("```");
				break;
			}
			case "blockMath":
				lines.push(`$$${String(node.attrs?.latex ?? "")}$$`);
				break;
			case "horizontalRule":
				lines.push("---");
				break;
			case "blockquote":
				for (const line of blocksToLines(node.content)) {
					lines.push(line ? `> ${line}` : ">");
				}
				break;
			case "bulletList":
			case "orderedList": {
				const ordered = node.type === "orderedList";
				let counter = Number(node.attrs?.start ?? 1);
				for (const item of node.content ?? []) {
					const marker = ordered ? `${counter}. ` : "- ";
					const itemLines = blocksToLines(item.content);
					const [head = "", ...tail] = itemLines;
					lines.push(`${marker}${head}`.trimEnd());
					// Children are indented by the marker width so the parser can
					// tell them apart from the next item.
					for (const line of tail) lines.push(line ? `  ${line}` : "");
					counter += 1;
				}
				break;
			}
			case "table": {
				const rows = node.content ?? [];
				let hasHeader = false;
				rows.forEach((row, rowIndex) => {
					const cells = (row.content ?? []).map((cell) =>
						inlineToText(cell.content?.flatMap((block) => block.content ?? [])),
					);
					if (rowIndex === 0) {
						hasHeader = (row.content ?? []).some(
							(cell) => cell.type === "tableHeader",
						);
					}
					lines.push(`| ${cells.map(escapeCell).join(" | ")} |`);
					if (rowIndex === 0 && hasHeader) {
						lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
					}
				});
				break;
			}
			default:
				// Unknown block: keep its text rather than dropping content.
				lines.push(...blocksToLines(node.content));
		}
	}

	return lines;
}

function escapeCell(value: string): string {
	return value.replace(/\|/g, "\\|");
}

/** Renders a card document as markdown with references in compact form. */
export function cardContentToTextWithReferences(content: unknown): string {
	const doc = content as Node | null;
	const blocks = doc?.content ?? [];
	const [first, ...rest] = blocks;
	if (!first) return "";
	// The first line is the title and is written bare, matching what an agent
	// sends when it creates a card.
	const title =
		first.type === "heading"
			? inlineToText(first.content)
			: blocksToLines([first]).join("\n");
	return [title, ...blocksToLines(rest)].join("\n");
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
