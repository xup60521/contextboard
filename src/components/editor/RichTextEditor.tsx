import "katex/dist/katex.min.css";
import "./editor.css";

import { EditorContent } from "@tiptap/react";
import { useRef } from "react";
import { cn } from "#/lib/utils";
import { useImageInputState } from "./hooks/useImageInputState";
import { useMathEditorState } from "./hooks/useMathEditorState";
import { useRichTextContentSync } from "./hooks/useRichTextContentSync";
import { useRichTextCtrlHolding } from "./hooks/useRichTextCtrlHolding";
import { useRichTextEditableMode } from "./hooks/useRichTextEditableMode";
import { useRichTextEditorInstance } from "./hooks/useRichTextEditorInstance";
import { useRichTextReady } from "./hooks/useRichTextReady";
import { useRichTextRuntimeRefs } from "./hooks/useRichTextRuntimeRefs";
import type { RichTextEditorProps } from "./RichTextEditor.types";
import { RichTextEditorChrome } from "./RichTextEditorChrome";

export function RichTextEditor({
	content,
	onChange,
	onReady,
	placeholder,
	className,
	editable = true,
	contentClassName = "min-h-[60vh]",
	defaultFocusPosition = "end",
	selectContentOnFocus = false,
	onImageUpload,
	cardReferenceSupport,
	showChrome = true,
	syncContentOnPropChange = false,
}: RichTextEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const runtimeRefs = useRichTextRuntimeRefs({
		editable,
		onImageUpload,
		cardReferenceSupport,
	});
	const {
		mathSelection,
		mathSelectionRef,
		openMathSelection,
		findInsertedMathSelection,
	} = useMathEditorState();
	const {
		imageInputPos,
		syncFromEditorTransaction: syncImageInputFromTransaction,
		clearImageInput,
	} = useImageInputState();
	const editor = useRichTextEditorInstance({
		content,
		placeholder,
		contentClassName,
		runtimeRefs,
		openMathSelection,
		mathSelectionRef,
		findInsertedMathSelection,
		syncImageInputFromTransaction,
		onChange,
	});

	useRichTextEditableMode({
		editor,
		editable,
		defaultFocusPosition,
		selectContentOnFocus,
		containerRef,
		openMathSelection,
		clearImageInput,
	});
	useRichTextContentSync({
		editor,
		content,
		syncContentOnPropChange,
	});
	useRichTextReady({
		editor,
		onReady,
		containerRef,
	});
	useRichTextCtrlHolding({
		editor,
		containerRef,
	});

	if (!editor) {
		return null;
	}

	return (
		<div
			ref={containerRef}
			className={cn(
				className,
				"rich-text-editor-shell relative",
				editable && "cursor-text",
			)}
		>
			<RichTextEditorChrome
				editor={editor}
				editable={editable}
				showChrome={showChrome}
				containerRef={containerRef}
				imageInputPos={imageInputPos}
				mathSelection={mathSelection}
				onCloseMathEditor={() => openMathSelection(null)}
			/>
			<EditorContent editor={editor} />
		</div>
	);
}
