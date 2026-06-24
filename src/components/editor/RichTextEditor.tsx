import "katex/dist/katex.min.css";
import "./editor.css";

import type { JSONContent } from "@tiptap/core";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
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

type MathCandidate = MathSelection & {
	nodeSize: number;
};

function clampPosition(pos: number, max: number) {
	return Math.min(Math.max(pos, 0), max);
}

function selectionDistance(candidate: MathCandidate, pos: number) {
	if (pos >= candidate.pos && pos <= candidate.pos + candidate.nodeSize) {
		return 0;
	}

	return Math.min(
		Math.abs(pos - candidate.pos),
		Math.abs(pos - (candidate.pos + candidate.nodeSize)),
	);
}

function findInsertedMathSelection(
	transaction: Transaction,
): MathSelection | null {
	if (!transaction.docChanged) {
		return null;
	}

	const candidates: MathCandidate[] = [];

	transaction.steps.forEach((step, index) => {
		step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
			const oldSize = oldEnd - oldStart;
			const newSize = newEnd - newStart;

			if (newSize <= 0 || newSize === oldSize) {
				return;
			}

			const laterMapping = transaction.mapping.slice(index + 1);
			const from = clampPosition(
				laterMapping.map(newStart, -1),
				transaction.doc.content.size,
			);
			const to = clampPosition(
				laterMapping.map(newEnd, 1),
				transaction.doc.content.size,
			);

			if (to <= from) {
				return;
			}

			transaction.doc.nodesBetween(from, to, (node, pos) => {
				if (node.type.name === "inlineMath" || node.type.name === "blockMath") {
					candidates.push({
						pos,
						type: node.type.name === "inlineMath" ? "inline" : "block",
						latex: String(node.attrs.latex ?? ""),
						nodeSize: node.nodeSize,
					});
					return false;
				}

				return true;
			});
		});
	});

	if (candidates.length === 0) {
		return null;
	}

	const [closest] = candidates.sort((a, b) => {
		const distanceDifference =
			selectionDistance(a, transaction.selection.from) -
			selectionDistance(b, transaction.selection.from);

		if (distanceDifference !== 0) {
			return distanceDifference;
		}

		return b.pos - a.pos;
	});

	return {
		pos: closest.pos,
		type: closest.type,
		latex: closest.latex,
	};
}

export function RichTextEditor({
	content,
	onChange,
	placeholder,
	className,
}: RichTextEditorProps) {
	const [mathSelection, setMathSelection] = useState<MathSelection | null>(
		null,
	);
	const mathSelectionRef = useRef<MathSelection | null>(null);

	function openMathSelection(selection: MathSelection | null) {
		mathSelectionRef.current = selection;
		setMathSelection(selection);
	}

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
						openMathSelection({
							pos,
							type: "inline",
							latex: String(node.attrs.latex ?? ""),
						}),
				},
				blockOptions: {
					onClick: (node, pos) =>
						openMathSelection({
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
				openMathSelection({
					pos: selection.from,
					type: node.type.name === "inlineMath" ? "inline" : "block",
					latex: String(node.attrs.latex ?? ""),
				});
				return true;
			},
		},
		onTransaction: ({ transaction }) => {
			if (mathSelectionRef.current) {
				return;
			}

			const insertedMathSelection = findInsertedMathSelection(transaction);
			if (insertedMathSelection) {
				openMathSelection(insertedMathSelection);
			}
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
					onClose={() => openMathSelection(null)}
				/>
			)}
		</div>
	);
}
