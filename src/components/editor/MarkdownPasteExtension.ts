import { Extension } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt("commonmark", { breaks: true, html: false });

md.block.ruler.before(
	"paragraph",
	"math_block",
	(state, startLine, endLine) => {
		const start = state.bMarks[startLine] + state.tShift[startLine];
		const max = state.eMarks[startLine];
		const firstLine = state.src.slice(start, max);

		if (!firstLine.startsWith("$$")) {
			return false;
		}

		const firstLineContent = firstLine.slice(2).trim();
		if (firstLineContent.endsWith("$$") && firstLineContent.length > 2) {
			const token = state.push("math_block", "div", 0);
			token.block = true;
			token.markup = "$$";
			token.content = firstLineContent.slice(0, -2).trim();
			token.map = [startLine, startLine + 1];
			state.line = startLine + 1;
			return true;
		}

		const lines: string[] = [];
		if (firstLineContent) {
			lines.push(firstLineContent);
		}

		for (let line = startLine + 1; line < endLine; line++) {
			const lineStart = state.bMarks[line] + state.tShift[line];
			const lineEnd = state.eMarks[line];
			const lineText = state.src.slice(lineStart, lineEnd);

			if (lineText.trim() === "$$") {
				const token = state.push("math_block", "div", 0);
				token.block = true;
				token.markup = "$$";
				token.content = lines.join("\n").trim();
				token.map = [startLine, line + 1];
				state.line = line + 1;
				return true;
			}

			lines.push(lineText);
		}

		return false;
	},
);

md.inline.ruler.before("escape", "math_inline", (state, silent) => {
	if (state.src.charCodeAt(state.pos) !== 0x24) {
		return false;
	}

	if (state.src.charCodeAt(state.pos + 1) === 0x24) {
		return false;
	}

	let end = state.pos + 1;

	while (end < state.posMax) {
		end = state.src.indexOf("$", end);
		if (end === -1) {
			return false;
		}

		const isEscaped = state.src.charCodeAt(end - 1) === 0x5c;
		const isDoubleDollar = state.src.charCodeAt(end + 1) === 0x24;

		if (!isEscaped && !isDoubleDollar) {
			break;
		}

		end += 1;
	}

	const latex = state.src.slice(state.pos + 1, end).trim();
	if (!latex) {
		return false;
	}

	if (!silent) {
		const token = state.push("math_inline", "span", 0);
		token.markup = "$";
		token.content = latex;
	}

	state.pos = end + 1;
	return true;
});

md.renderer.rules.math_block = (tokens, idx) => {
	const token = tokens[idx];
	if (!token) return "";

	return `<div data-type="block-math" data-latex="${escapeAttribute(token.content)}"></div>`;
};

md.renderer.rules.math_inline = (tokens, idx) => {
	const token = tokens[idx];
	if (!token) return "";

	return `<span data-type="inline-math" data-latex="${escapeAttribute(token.content)}"></span>`;
};

function looksLikeMarkdown(text: string): boolean {
	const lines = text.split("\n");
	for (const line of lines) {
		if (/^\s{0,3}(#{1,6})\s/.test(line)) return true;
		if (/^\s{0,3}>\s/.test(line)) return true;
		if (/^\s{0,3}[-*+]\s/.test(line)) return true;
		if (/^\s{0,3}\d+\.\s/.test(line)) return true;
		if (/^\s{0,3}`{3,}/.test(line)) return true;
		if (/^\s{0,3}---\s*$/.test(line)) return true;
		if (/^\s{0,3}\*\*\*?\s*$/.test(line)) return true;
		if (/^\s{0,3}\$\$/.test(line)) return true;
	}
	if (/\*\*[^*]+\*\*/.test(text)) return true;
	if (/\*[^*]+\*/.test(text)) return true;
	if (/\[.+\]\(.+\)/.test(text)) return true;
	if (/~~[^~]+~~/.test(text)) return true;
	if (/(^|[^$])\$[^$\n]+\$(?!\$)/.test(text)) return true;
	return false;
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export const MarkdownPaste = Extension.create({
	name: "markdownPaste",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey("markdownPaste"),
				props: {
					handlePaste: (view, event) => {
						const clipboardData = event.clipboardData;
						if (!clipboardData) return false;

						const plainText = clipboardData.getData("text/plain");
						if (!plainText) return false;

						if (!looksLikeMarkdown(plainText)) return false;

						const html = md.render(plainText);
						if (!html) return false;

						const { state } = view;
						const container = document.createElement("div");
						container.innerHTML = html;

						const slice = ProseMirrorDOMParser.fromSchema(
							state.schema,
						).parseSlice(container);

						if (slice.content.size === 0) {
							return false;
						}

						event.preventDefault();
						view.dispatch(state.tr.replaceSelection(slice).scrollIntoView());
						return true;
					},
				},
			}),
		];
	},
});
