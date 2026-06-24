import "katex/dist/katex.min.css";
import "./editor.css";

import type { JSONContent } from "@tiptap/core";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { MathEditor, type MathSelection } from "./MathEditor";
import { SlashCommand } from "./slash/slash-command";

type RichTextEditorProps = {
	/** Initial document (TipTap JSON). The editor is the source of truth after mount. */
	content?: JSONContent | null;
	onChange?: (value: JSONContent) => void;
	placeholder?: string;
	className?: string;
};

export function RichTextEditor({
	content,
	onChange,
	placeholder,
	className,
}: RichTextEditorProps) {
	const [mathSelection, setMathSelection] = useState<MathSelection | null>(
		null,
	);

	const editor = useEditor({
		// Required under TanStack Start SSR to avoid a hydration mismatch.
		immediatelyRender: false,
		extensions: [
			StarterKit,
			Placeholder.configure({
				placeholder: placeholder ?? "Type '/' for commands",
			}),
			Mathematics.configure({
				inlineOptions: {
					onClick: (node, pos) =>
						setMathSelection({
							pos,
							type: "inline",
							latex: String(node.attrs.latex ?? ""),
						}),
				},
				blockOptions: {
					onClick: (node, pos) =>
						setMathSelection({
							pos,
							type: "block",
							latex: String(node.attrs.latex ?? ""),
						}),
				},
			}),
			SlashCommand,
		],
		content: content ?? "",
		editorProps: {
			attributes: {
				class:
					"prose dark:prose-invert max-w-none focus:outline-none min-h-[60vh]",
			},
			// When a math node is selected, Enter opens its editor instead of
			// inserting a new line.
			handleKeyDown: (view, event) => {
				if (event.key !== "Enter" || event.shiftKey) {
					return false;
				}
				const { selection } = view.state;
				if (!(selection instanceof NodeSelection)) {
					return false;
				}
				const { node } = selection;
				if (node.type.name !== "inlineMath" && node.type.name !== "blockMath") {
					return false;
				}
				setMathSelection({
					pos: selection.from,
					type: node.type.name === "inlineMath" ? "inline" : "block",
					latex: String(node.attrs.latex ?? ""),
				});
				return true;
			},
		},
		onUpdate: ({ editor: instance }) => {
			onChange?.(instance.getJSON());
		},
	});

	if (!editor) {
		return null;
	}

	return (
		<div className={className}>
			<EditorBubbleMenu editor={editor} />
			<EditorContent editor={editor} />
			{mathSelection && (
				<MathEditor
					key={mathSelection.pos}
					editor={editor}
					selection={mathSelection}
					onClose={() => setMathSelection(null)}
				/>
			)}
		</div>
	);
}
