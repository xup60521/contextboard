import type { Content, Editor, Range } from "@tiptap/core";
import {
	Code2,
	Heading1,
	Heading2,
	Heading3,
	Image,
	ImageUp,
	List,
	ListCollapse,
	ListOrdered,
	Minus,
	Quote,
	Sigma,
	SquareSigma,
	Table2,
	Text,
} from "lucide-react";
import type { ComponentType } from "react";
import { imageInputPluginKey } from "../ImageInputExtension";

export type SlashCommandItem = {
	title: string;
	subtitle: string;
	icon: ComponentType<{ className?: string }>;
	searchTerms: string[];
	command: (props: { editor: Editor; range: Range }) => void;
};

function clampPosition(pos: number, max: number) {
	return Math.min(Math.max(pos, 0), max);
}

function replaceSlashRangeWithContent(
	editor: Editor,
	range: Range,
	content: Content,
) {
	editor
		.chain()
		.focus()
		.command(({ tr, commands }) => {
			const docSize = tr.doc.content.size;
			const from = clampPosition(range.from, docSize);
			const to = clampPosition(Math.max(range.to, from), docSize);

			tr.delete(from, to);

			const insertPos = clampPosition(
				tr.mapping.map(from),
				tr.doc.content.size,
			);
			return commands.insertContentAt(insertPos, content);
		})
		.run();
}

export const slashCommandItems: SlashCommandItem[] = [
	{
		title: "Text",
		subtitle: "Plain paragraph",
		icon: Text,
		searchTerms: ["paragraph", "text", "plain", "body"],
		command: ({ editor, range }) =>
			editor.chain().focus().deleteRange(range).setNode("paragraph").run(),
	},
	{
		title: "Heading 1",
		subtitle: "Large section heading",
		icon: Heading1,
		searchTerms: ["title", "h1", "heading", "large"],
		command: ({ editor, range }) =>
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.setNode("heading", { level: 1 })
				.run(),
	},
	{
		title: "Heading 2",
		subtitle: "Medium section heading",
		icon: Heading2,
		searchTerms: ["subtitle", "h2", "heading", "medium"],
		command: ({ editor, range }) =>
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.setNode("heading", { level: 2 })
				.run(),
	},
	{
		title: "Heading 3",
		subtitle: "Small section heading",
		icon: Heading3,
		searchTerms: ["h3", "heading", "small"],
		command: ({ editor, range }) =>
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.setNode("heading", { level: 3 })
				.run(),
	},
	{
		title: "Bullet List",
		subtitle: "Unordered list",
		icon: List,
		searchTerms: ["unordered", "bullet", "list", "ul"],
		command: ({ editor, range }) =>
			editor.chain().focus().deleteRange(range).toggleBulletList().run(),
	},
	{
		title: "Numbered List",
		subtitle: "Ordered list",
		icon: ListOrdered,
		searchTerms: ["ordered", "numbered", "list", "ol"],
		command: ({ editor, range }) =>
			editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
	},
	{
		title: "Table",
		subtitle: "3 x 3 table",
		icon: Table2,
		searchTerms: ["table", "grid", "cells", "rows", "columns"],
		command: ({ editor, range }) =>
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
				.run(),
	},
	{
		title: "Dropdown",
		subtitle: "Collapsible section",
		icon: ListCollapse,
		searchTerms: ["dropdown", "details", "summary", "collapse", "toggle"],
		command: ({ editor, range }) =>
			replaceSlashRangeWithContent(editor, range, {
				type: "details",
				attrs: { open: true },
				content: [
					{
						type: "detailsSummary",
						content: [{ type: "text", text: "Dropdown" }],
					},
					{
						type: "detailsContent",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text: "Hidden content" }],
							},
						],
					},
				],
			}),
	},
	{
		title: "Quote",
		subtitle: "Blockquote",
		icon: Quote,
		searchTerms: ["quote", "blockquote", "cite"],
		command: ({ editor, range }) =>
			editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
	},
	{
		title: "Code Block",
		subtitle: "Fenced code block",
		icon: Code2,
		searchTerms: ["code", "codeblock", "fenced", "pre"],
		command: ({ editor, range }) =>
			editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
	},
	{
		title: "Divider",
		subtitle: "Horizontal rule",
		icon: Minus,
		searchTerms: ["divider", "horizontal", "rule", "hr", "separator"],
		command: ({ editor, range }) =>
			editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
	},
	{
		title: "Inline Math",
		subtitle: "KaTeX inline equation",
		icon: Sigma,
		searchTerms: ["math", "inline", "katex", "latex", "equation", "formula"],
		command: ({ editor, range }) =>
			replaceSlashRangeWithContent(editor, range, {
				type: "inlineMath",
				attrs: { latex: "E = mc^2" },
			}),
	},
	{
		title: "Block Math",
		subtitle: "KaTeX display equation",
		icon: SquareSigma,
		searchTerms: ["math", "block", "katex", "latex", "equation", "display"],
		command: ({ editor, range }) =>
			replaceSlashRangeWithContent(editor, range, {
				type: "blockMath",
				attrs: { latex: "\\int_0^1 x^2\\,dx" },
			}),
	},
	{
		title: "Image",
		subtitle: "Embed an image from URL",
		icon: Image,
		searchTerms: ["image", "picture", "photo", "img", "upload", "url"],
		command: ({ editor, range }) => {
			const docSize = editor.state.doc.content.size;
			const from = Math.min(range.from, docSize);
			const to = Math.min(Math.max(range.to, from), docSize);

			editor
				.chain()
				.focus()
				.command(({ tr, commands }) => {
					tr.delete(from, to);
					const insertPos = tr.mapping.map(from);
					return commands.insertContentAt(insertPos, {
						type: "paragraph",
						content: [],
					});
				})
				.setMeta(imageInputPluginKey, {
					pos: editor.state.selection.from,
				})
				.run();
		},
	},
	{
		title: "Upload Image",
		subtitle: "Upload an image file",
		icon: ImageUp,
		searchTerms: ["upload", "image", "photo", "picture", "file", "img"],
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).run();
			// No-op when the editor has no upload handler (command unregistered).
			editor.commands.uploadImageFromPicker?.();
		},
	},
];

export function filterSlashItems(query: string): SlashCommandItem[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return slashCommandItems;
	}

	return slashCommandItems.filter(
		(item) =>
			item.title.toLowerCase().includes(normalized) ||
			item.searchTerms.some((term) => term.includes(normalized)),
	);
}
