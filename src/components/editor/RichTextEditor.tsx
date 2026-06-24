import "katex/dist/katex.min.css";
import "./editor.css";

import type { JSONContent } from "@tiptap/core";
import {
	Details,
	DetailsContent,
	DetailsSummary,
} from "@tiptap/extension-details";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import {
	MarkdownPaste,
	skipMathEditorAutoOpenMeta,
} from "./MarkdownPasteExtension";
import { MathEditor, type MathSelection } from "./MathEditor";
import { SlashCommand } from "./slash/slash-command";
import { cn } from "#/lib/utils";

type RichTextEditorProps = {
	/** Initial document (TipTap JSON). The editor is the source of truth after mount. */
	content?: JSONContent | null;
	onChange?: (value: JSONContent) => void;
	placeholder?: string;
	className?: string;
	/** When false, the editor is read-only. Defaults to true. */
	editable?: boolean;
	/** Class applied to the editing surface (e.g. min-height). */
	contentClassName?: string;
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
	editable = true,
	contentClassName = "min-h-[60vh]",
}: RichTextEditorProps) {
	const [mathSelection, setMathSelection] = useState<MathSelection | null>(
		null,
	);
	const mathSelectionRef = useRef<MathSelection | null>(null);
	const wasEditableRef = useRef(editable);

	function openMathSelection(selection: MathSelection | null) {
		mathSelectionRef.current = selection;
		setMathSelection(selection);
	}

	const editor = useEditor({
		// Required under TanStack Start SSR to avoid a hydration mismatch.
		immediatelyRender: false,
		extensions: [
			StarterKit,
			TableKit.configure({
				table: {
					HTMLAttributes: {
						class: "editor-table",
					},
				},
				tableCell: {},
				tableHeader: {},
				tableRow: {},
			}),
			Details.configure({
				persist: true,
				HTMLAttributes: {
					class: "editor-details",
				},
				renderToggleButton: ({ element, isOpen }) => {
					element.setAttribute(
						"aria-label",
						isOpen ? "Collapse dropdown" : "Expand dropdown",
					);
					element.dataset.state = isOpen ? "open" : "closed";
				},
			}),
			DetailsSummary.configure({
				HTMLAttributes: {
					class: "editor-details-summary",
				},
			}),
			DetailsContent.configure({
				HTMLAttributes: {
					class: "editor-details-content",
				},
			}),
			MarkdownPaste,
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
				class: `prose dark:prose-invert max-w-none focus:outline-none ${contentClassName}`,
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

			if (transaction.getMeta(skipMathEditorAutoOpenMeta)) {
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

	// `useEditor` reads `editable` only at creation, so keep it in sync. Focus the
	// editor when it transitions into edit mode (e.g. a card enters editing) without
	// stealing focus on an always-editable page's initial mount.
	useEffect(() => {
		if (!editor) {
			return;
		}

		editor.setEditable(editable);

		if (editable && !wasEditableRef.current) {
			editor.commands.focus("end");
		}

		wasEditableRef.current = editable;
	}, [editor, editable]);

	if (!editor) {
		return null;
	}

	return (
		<div className={cn(className, "cursor-text")}>
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
