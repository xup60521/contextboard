import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { useEditor } from "@tiptap/react";
import type { RefObject } from "react";
import { createRichTextExtensions } from "../createRichTextExtensions";
import { skipMathEditorAutoOpenMeta } from "../MarkdownPasteExtension";
import type {
	MathSelection,
	RichTextRuntimeRefs,
} from "../RichTextEditor.types";

type UseRichTextEditorInstanceInput = {
	content?: JSONContent | null;
	placeholder?: string;
	contentClassName: string;
	runtimeRefs: RichTextRuntimeRefs;
	openMathSelection: (selection: MathSelection | null) => void;
	mathSelectionRef: RefObject<MathSelection | null>;
	findInsertedMathSelection: (transaction: Transaction) => MathSelection | null;
	syncImageInputFromTransaction: (editor: Editor) => void;
	onChange?: (value: JSONContent) => void;
};

export function useRichTextEditorInstance({
	content,
	placeholder,
	contentClassName,
	runtimeRefs,
	openMathSelection,
	mathSelectionRef,
	findInsertedMathSelection,
	syncImageInputFromTransaction,
	onChange,
}: UseRichTextEditorInstanceInput) {
	const editor = useEditor({
		// Required under TanStack Start SSR to avoid a hydration mismatch.
		immediatelyRender: false,
		extensions: createRichTextExtensions({
			placeholder,
			runtime: runtimeRefs,
			onMathClick: (selection) => openMathSelection(selection),
		}),
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
		onTransaction: ({ transaction, editor: instance }) => {
			syncImageInputFromTransaction(instance);

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

	return editor;
}
