import { createFileRoute } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import { RichTextEditor } from "#/components/editor/RichTextEditor";

export const Route = createFileRoute("/test/markdown")({
	component: RouteComponent,
});

const INITIAL_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "Markdown card" }],
		},
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "Type '/' on a new line to insert blocks, select text for the formatting menu, and write inline math like ",
				},
				{ type: "inlineMath", attrs: { latex: "E = mc^2" } },
				{ type: "text", text: " right in the flow." },
			],
		},
		{
			type: "blockMath",
			attrs: { latex: "\\int_0^1 x^2\\,dx = \\frac{1}{3}" },
		},
		{
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Slash commands" }],
						},
					],
				},
				{
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Bubble menu formatting" }],
						},
					],
				},
				{
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "KaTeX math, inline and block" }],
						},
					],
				},
			],
		},
	],
};

	function RouteComponent() {
	const [doc, setDoc] = useState<JSONContent>(INITIAL_CONTENT);

	return (
		<main className="page-wrap py-10">
			<header className="mb-6">
				<p className="island-kicker">Test bed</p>
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
					Markdown card editor
				</h1>
				<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
					A TipTap rich-text editor with slash commands and KaTeX math. Content
					is kept locally on this page. Tip: click any equation to edit its
					LaTeX.
				</p>
			</header>

			<RichTextEditor
				content={INITIAL_CONTENT}
				onChange={setDoc}
				className="notion-editor seamless"
				contentClassName="min-h-[60vh] bg-[var(--bg-base)]"
			/>

			<details className="mt-6">
				<summary className="cursor-pointer text-sm font-semibold text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]">
					Document JSON
				</summary>
				<pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-xs text-[var(--sea-ink)]">
					{JSON.stringify(doc, null, 2)}
				</pre>
			</details>
		</main>
	);
}
