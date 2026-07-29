import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { type RefObject, useEffect, useRef } from "react";
import type { MathSelection } from "../RichTextEditor.types";

function selectionBelongsToEditor(
	root: HTMLElement,
	selection: Selection,
): boolean {
	return (
		(selection.anchorNode !== null && root.contains(selection.anchorNode)) ||
		(selection.focusNode !== null && root.contains(selection.focusNode))
	);
}

export function useRichTextEditableMode({
	editor,
	editable,
	defaultFocusPosition,
	selectContentOnFocus,
	containerRef,
	openMathSelection,
	clearImageInput,
}: {
	editor: Editor | null;
	editable: boolean;
	defaultFocusPosition: "start" | "end";
	selectContentOnFocus: boolean;
	containerRef: RefObject<HTMLDivElement | null>;
	openMathSelection: (selection: MathSelection | null) => void;
	clearImageInput: (editor: Editor) => void;
}) {
	const wasEditableRef = useRef(editable);

	useEffect(() => {
		if (!editor) {
			return;
		}

		editor.setEditable(editable);

		if (!editable && editor.state.selection instanceof NodeSelection) {
			editor.commands.setTextSelection(editor.state.doc.content.size);
		}

		if (editable && !wasEditableRef.current) {
			editor.commands.focus(defaultFocusPosition);

			if (selectContentOnFocus) {
				const firstChild = editor.state.doc.content.firstChild;
				if (firstChild) {
					editor.commands.setTextSelection({
						from: 1,
						to: firstChild.nodeSize - 1,
					});
				}
			}
		}

		if (!editable && wasEditableRef.current) {
			openMathSelection(null);
			editor.commands.blur();
			clearImageInput(editor);

			const container = containerRef.current;
			const selection = window.getSelection();

			if (
				container &&
				selection &&
				selection.rangeCount > 0 &&
				selectionBelongsToEditor(container, selection)
			) {
				selection.removeAllRanges();
			}
		}

		wasEditableRef.current = editable;
	}, [
		clearImageInput,
		containerRef,
		defaultFocusPosition,
		editable,
		editor,
		openMathSelection,
		selectContentOnFocus,
	]);
}
