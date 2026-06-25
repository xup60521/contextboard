import type { JSONContent } from "@tiptap/core";

const MARKDOWN_CARD_HORIZONTAL_CHROME = 64;
const MARKDOWN_CARD_VERTICAL_CHROME = 64;
const APPROX_CHAR_WIDTH = 8;
const BLOCK_SPACING = 12;
const BLOCK_HEIGHT = 18;
const LINE_HEIGHT = 22;

type MarkdownNodeStats = {
	blockCount: number;
	lineCount: number;
};

export type ResolveMarkdownCardHeightInput = {
	currentHeight: number;
	measuredScrollHeight: number | null;
	headerHeight: number;
	minHeight: number;
	isEditorReady: boolean;
	isVisible: boolean;
};

export function estimateMarkdownCardHeight(
	content: string,
	width: number,
	minHeight: number,
): number {
	const parsed = parseMarkdownCardContent(content);
	if (!parsed) return minHeight;

	const usableWidth = Math.max(
		160,
		Math.max(width, 0) - MARKDOWN_CARD_HORIZONTAL_CHROME,
	);
	const charsPerLine = Math.max(
		18,
		Math.floor(usableWidth / APPROX_CHAR_WIDTH),
	);
	const { blockCount, lineCount } = collectMarkdownNodeStats(
		parsed,
		charsPerLine,
	);

	if (blockCount === 0 && lineCount === 0) {
		return minHeight;
	}

	const estimatedHeight =
		MARKDOWN_CARD_VERTICAL_CHROME +
		blockCount * BLOCK_HEIGHT +
		lineCount * LINE_HEIGHT +
		Math.max(0, blockCount - 1) * BLOCK_SPACING;

	return Math.max(minHeight, Math.ceil(estimatedHeight));
}

export function getHydratedMarkdownCardHeight({
	content,
	width,
	serverHeight,
	minHeight,
}: {
	content: string;
	width: number;
	serverHeight: number;
	minHeight: number;
}) {
	return Math.max(
		serverHeight,
		estimateMarkdownCardHeight(content, width, minHeight),
	);
}

export function resolveMarkdownCardHeight({
	currentHeight,
	measuredScrollHeight,
	headerHeight,
	minHeight,
	isEditorReady,
	isVisible,
}: ResolveMarkdownCardHeightInput) {
	if (
		!isEditorReady ||
		!isVisible ||
		measuredScrollHeight === null ||
		!Number.isFinite(measuredScrollHeight)
	) {
		return currentHeight;
	}

	const nextHeight = Math.max(
		minHeight,
		Math.ceil(measuredScrollHeight) - headerHeight + headerHeight,
	);

	return Math.ceil(nextHeight);
}

function parseMarkdownCardContent(content: string): JSONContent | null {
	if (!content) return null;

	try {
		return JSON.parse(content) as JSONContent;
	} catch {
		return null;
	}
}

function collectMarkdownNodeStats(
	node: JSONContent,
	charsPerLine: number,
): MarkdownNodeStats {
	if (node.type === "text") {
		const text = typeof node.text === "string" ? node.text : "";
		return {
			blockCount: 0,
			lineCount: countWrappedLines(text, charsPerLine),
		};
	}

	if (node.type === "hardBreak") {
		return { blockCount: 0, lineCount: 1 };
	}

	const childStats = (node.content ?? []).map((child) =>
		collectMarkdownNodeStats(child, charsPerLine),
	);

	const nestedBlockCount = childStats.reduce(
		(total, child) => total + child.blockCount,
		0,
	);
	const nestedLineCount = childStats.reduce(
		(total, child) => total + child.lineCount,
		0,
	);

	if (node.type === "doc") {
		return {
			blockCount: nestedBlockCount,
			lineCount: nestedLineCount,
		};
	}

	if (isStructuralBlockNode(node.type)) {
		return {
			blockCount: nestedBlockCount + 1,
			lineCount: Math.max(1, nestedLineCount),
		};
	}

	return {
		blockCount: nestedBlockCount,
		lineCount: nestedLineCount,
	};
}

function countWrappedLines(text: string, charsPerLine: number) {
	if (!text) return 0;

	return text
		.split(/\r?\n/)
		.reduce(
			(total, segment) =>
				total + Math.max(1, Math.ceil(segment.length / charsPerLine)),
			0,
		);
}

function isStructuralBlockNode(type: string | undefined) {
	if (!type) return false;

	return (
		type === "paragraph" ||
		type === "heading" ||
		type === "blockquote" ||
		type === "bulletList" ||
		type === "orderedList" ||
		type === "listItem" ||
		type === "taskList" ||
		type === "taskItem" ||
		type === "codeBlock" ||
		type === "table" ||
		type === "tableRow" ||
		type === "tableCell" ||
		type === "tableHeader" ||
		type === "details" ||
		type === "detailsSummary" ||
		type === "detailsContent" ||
		type === "blockMath" ||
		type === "horizontalRule"
	);
}
