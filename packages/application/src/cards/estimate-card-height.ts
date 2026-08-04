/**
 * Content-derived height estimate for a card that no client has rendered yet.
 *
 * An agent creating a card through the local agent server has no DOM, so it cannot
 * measure anything: without this the card lands at a flat `DEFAULT_CARD_HEIGHT`
 * that has nothing to do with its content, and nothing corrects it until a
 * human opens the card for editing.
 *
 * The numbers below approximate the card's prose typography. They are a
 * heuristic, not a layout engine — every rounding here is deliberately
 * generous, because a card that is slightly too tall only shows some empty
 * space while one that is too short visually clips its own text. The client
 * replaces the estimate with a real measurement the first time it renders the
 * card (see `measured-card-heights.ts` in the web UI).
 */

/** Card chrome, mirroring `PersistedMarkdownCardShape`'s header and `py-8`. */
const HEADER_HEIGHT = 28;
const VERTICAL_PADDING = 64;
/** `px-8` on both sides. */
const HORIZONTAL_PADDING = 64;
const MIN_HEIGHT = 96;
/** A pasted essay should still be a card, not a wall reaching off-screen. */
const MAX_ESTIMATED_HEIGHT = 1200;
/** Absorbs the error accumulated across blocks, biasing the estimate tall. */
const TRAILING_BUFFER = 8;

/**
 * Average glyph width as a fraction of font size. Real proportional text sits
 * near 0.5; the higher value here yields more wrapped lines, which is the safe
 * direction to be wrong in.
 */
const CHAR_WIDTH_RATIO = 0.55;
const MONO_CHAR_WIDTH_RATIO = 0.62;

type BlockMetrics = {
	fontSize: number;
	lineHeight: number;
	marginBottom: number;
	/** Width the block's text loses to indentation, bullets or quote bars. */
	indent: number;
	/** Vertical padding and borders the block adds around its own text. */
	extra: number;
	monospace?: boolean;
};

const PARAGRAPH: BlockMetrics = {
	fontSize: 16,
	lineHeight: 28,
	marginBottom: 16,
	indent: 0,
	extra: 0,
};

const HEADINGS: Record<number, BlockMetrics> = {
	1: { fontSize: 30, lineHeight: 38, marginBottom: 16, indent: 0, extra: 0 },
	2: { fontSize: 24, lineHeight: 32, marginBottom: 14, indent: 0, extra: 0 },
	3: { fontSize: 20, lineHeight: 28, marginBottom: 12, indent: 0, extra: 0 },
};

const LIST_ITEM: BlockMetrics = {
	...PARAGRAPH,
	marginBottom: 6,
	indent: 28,
};

const BLOCKQUOTE_TEXT: BlockMetrics = {
	...PARAGRAPH,
	indent: 24,
};

const CODE_BLOCK: BlockMetrics = {
	fontSize: 14,
	lineHeight: 22,
	marginBottom: 16,
	indent: 0,
	extra: 24,
	monospace: true,
};

/** Rule thickness plus the space prose leaves on either side of it. */
const HORIZONTAL_RULE_HEIGHT = 33;
const BLOCK_MATH_HEIGHT = 44;
const TABLE_ROW_HEIGHT = 40;
const TABLE_EXTRA = 16;
/** Nothing tells us an image's aspect ratio, so assume a modest one. */
const IMAGE_HEIGHT = 220;

type ProseNode = {
	type?: unknown;
	text?: unknown;
	attrs?: Record<string, unknown>;
	content?: unknown;
};

function asNode(value: unknown): ProseNode | null {
	return value && typeof value === "object" ? (value as ProseNode) : null;
}

function childrenOf(node: ProseNode): unknown[] {
	return Array.isArray(node.content) ? node.content : [];
}

/** Length of the text a block renders, counting math by its latex source. */
function inlineLength(value: unknown): number {
	const node = asNode(value);
	if (!node) return 0;
	if (node.type === "text") {
		return typeof node.text === "string" ? node.text.length : 0;
	}
	if (node.type === "inlineMath" || node.type === "blockMath") {
		return typeof node.attrs?.latex === "string" ? node.attrs.latex.length : 0;
	}
	let total = 0;
	for (const child of childrenOf(node)) total += inlineLength(child);
	return total;
}

/** Height of a run of text wrapped into `width`, always at least one line. */
function textBlockHeight(
	characters: number,
	width: number,
	metrics: BlockMetrics,
): number {
	const ratio = metrics.monospace ? MONO_CHAR_WIDTH_RATIO : CHAR_WIDTH_RATIO;
	const charsPerLine = Math.max(
		1,
		Math.floor((width - metrics.indent) / (metrics.fontSize * ratio)),
	);
	const lines = Math.max(1, Math.ceil(characters / charsPerLine));
	return Math.ceil(lines * metrics.lineHeight + metrics.extra);
}

/** Code blocks do not wrap, so each source line is exactly one rendered line. */
function codeBlockHeight(node: ProseNode): number {
	let lines = 0;
	for (const child of childrenOf(node)) {
		const text = asNode(child)?.text;
		if (typeof text === "string") lines += text.split("\n").length;
	}
	return Math.ceil(
		Math.max(1, lines) * CODE_BLOCK.lineHeight + CODE_BLOCK.extra,
	);
}

function tableHeight(node: ProseNode): number {
	const rows = childrenOf(node).filter(
		(child) => asNode(child)?.type === "tableRow",
	).length;
	return Math.max(1, rows) * TABLE_ROW_HEIGHT + TABLE_EXTRA;
}

/** Height and trailing margin of one block, or null if it renders nothing. */
function blockHeight(
	value: unknown,
	width: number,
): { height: number; marginBottom: number } | null {
	const node = asNode(value);
	if (!node || typeof node.type !== "string") return null;

	switch (node.type) {
		case "heading": {
			const level =
				typeof node.attrs?.level === "number" ? node.attrs.level : 1;
			const metrics = HEADINGS[level] ?? HEADINGS[3];
			return {
				height: textBlockHeight(inlineLength(node), width, metrics),
				marginBottom: metrics.marginBottom,
			};
		}
		case "paragraph":
			return {
				height: textBlockHeight(inlineLength(node), width, PARAGRAPH),
				marginBottom: PARAGRAPH.marginBottom,
			};
		case "bulletList":
		case "orderedList": {
			// Nested lists arrive as children of their `listItem`, so recursing
			// through the items keeps the indentation accounting in one place.
			let height = 0;
			for (const item of childrenOf(node)) {
				height += listItemHeight(item, width);
			}
			return {
				height: Math.max(LIST_ITEM.lineHeight, height),
				marginBottom: PARAGRAPH.marginBottom,
			};
		}
		case "blockquote": {
			let height = 0;
			for (const child of childrenOf(node)) {
				const block = blockHeight(child, width - BLOCKQUOTE_TEXT.indent);
				if (block) height += block.height + block.marginBottom;
			}
			return {
				height: Math.max(BLOCKQUOTE_TEXT.lineHeight, height) + 8,
				marginBottom: PARAGRAPH.marginBottom,
			};
		}
		case "codeBlock":
			return {
				height: codeBlockHeight(node),
				marginBottom: CODE_BLOCK.marginBottom,
			};
		case "horizontalRule":
			return { height: HORIZONTAL_RULE_HEIGHT, marginBottom: 0 };
		case "blockMath":
			return { height: BLOCK_MATH_HEIGHT, marginBottom: PARAGRAPH.marginBottom };
		case "table":
			return { height: tableHeight(node), marginBottom: PARAGRAPH.marginBottom };
		case "image":
			return { height: IMAGE_HEIGHT, marginBottom: PARAGRAPH.marginBottom };
		default:
			// An unknown block still occupies space; one paragraph is the least
			// wrong guess available.
			return {
				height: textBlockHeight(inlineLength(node), width, PARAGRAPH),
				marginBottom: PARAGRAPH.marginBottom,
			};
	}
}

function listItemHeight(value: unknown, width: number): number {
	const node = asNode(value);
	if (!node) return 0;
	const inner = width - LIST_ITEM.indent;
	let height = 0;
	for (const child of childrenOf(node)) {
		const childNode = asNode(child);
		if (childNode?.type === "paragraph") {
			height += textBlockHeight(inlineLength(childNode), width, LIST_ITEM);
			continue;
		}
		const block = blockHeight(child, inner);
		if (block) height += block.height + block.marginBottom;
	}
	return height > 0 ? height + LIST_ITEM.marginBottom : LIST_ITEM.lineHeight;
}

/**
 * Estimates the card height, in canvas units, that `content` needs at `width`.
 *
 * Returns at least `MIN_HEIGHT` and never more than `MAX_ESTIMATED_HEIGHT`.
 * Content that is missing or not a ProseMirror document falls back to the
 * minimum, leaving the caller's own default in charge.
 */
export function estimateCardHeight(content: unknown, width: number): number {
	const doc = asNode(content);
	const blocks = doc ? childrenOf(doc) : [];
	const textWidth = Math.max(
		120,
		(Number.isFinite(width) ? width : 0) - HORIZONTAL_PADDING,
	);

	let contentHeight = 0;
	let pendingMargin = 0;
	for (const block of blocks) {
		const measured = blockHeight(block, textWidth);
		if (!measured) continue;
		// The margin of the block before this one only takes up space because
		// another block follows it; prose drops the last one.
		contentHeight += pendingMargin + measured.height;
		pendingMargin = measured.marginBottom;
	}

	if (contentHeight === 0) return MIN_HEIGHT;

	const total =
		HEADER_HEIGHT + VERTICAL_PADDING + contentHeight + TRAILING_BUFFER;
	return Math.min(
		MAX_ESTIMATED_HEIGHT,
		Math.max(MIN_HEIGHT, Math.ceil(total)),
	);
}
