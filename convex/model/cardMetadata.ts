const FALLBACK_TITLE = "Untitled card";
const MAX_PLAIN_TEXT_LENGTH = 10_000;
const MAX_PREVIEW_LENGTH = 400;

type JsonNode = {
	type?: unknown;
	text?: unknown;
	attrs?: Record<string, unknown>;
	content?: unknown;
};

export type CardMetadata = {
	derivedTitle: string;
	plainText: string;
	preview: string;
};

export function deriveCardMetadata(content: unknown): CardMetadata {
	const rows: string[] = [];
	collectRows(content, rows);

	const normalizedRows = rows
		.map(normalizeWhitespace)
		.filter((row) => row.length > 0);

	const plainText = clamp(
		normalizedRows.join("\n"),
		MAX_PLAIN_TEXT_LENGTH,
	).trim();
	const title = normalizedRows[0] ?? FALLBACK_TITLE;

	return {
		derivedTitle: title || FALLBACK_TITLE,
		plainText,
		preview: clamp(plainText, MAX_PREVIEW_LENGTH),
	};
}

function collectRows(value: unknown, rows: string[]) {
	if (!isNode(value)) return;

	if (value.type === "text" && typeof value.text === "string") {
		rows.push(value.text);
		return;
	}

	if (value.type === "inlineMath" || value.type === "blockMath") {
		const latex = value.attrs?.latex;
		if (typeof latex === "string") {
			rows.push(latex);
		}
		return;
	}

	if (!Array.isArray(value.content)) return;

	const childRows: string[] = [];
	for (const child of value.content) {
		collectRows(child, childRows);
	}

	if (isBlockNode(value.type)) {
		rows.push(childRows.join(" "));
		return;
	}

	rows.push(...childRows);
}

function isNode(value: unknown): value is JsonNode {
	return typeof value === "object" && value !== null;
}

function isBlockNode(type: unknown) {
	return (
		type === "heading" ||
		type === "paragraph" ||
		type === "listItem" ||
		type === "blockquote" ||
		type === "codeBlock" ||
		type === "tableCell" ||
		type === "tableHeader"
	);
}

function normalizeWhitespace(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function clamp(value: string, maxLength: number) {
	if (value.length <= maxLength) return value;
	return value.slice(0, maxLength).trimEnd();
}
