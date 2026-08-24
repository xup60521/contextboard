import { EditorContent } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { useImageInputState } from "./hooks/useImageInputState";
import { useMathEditorState } from "./hooks/useMathEditorState";
import { useRichTextContentSync } from "./hooks/useRichTextContentSync";
import { useRichTextCtrlHolding } from "./hooks/useRichTextCtrlHolding";
import { useRichTextEditableMode } from "./hooks/useRichTextEditableMode";
import { useRichTextEditorInstance } from "./hooks/useRichTextEditorInstance";
import { useRichTextReady } from "./hooks/useRichTextReady";
import { useRichTextRuntimeRefs } from "./hooks/useRichTextRuntimeRefs";
import { cn } from "./platform/utils";
import type { RichTextEditorProps } from "./RichTextEditor.types";
import { RichTextEditorChrome } from "./RichTextEditorChrome";
import { StaticRichTextRenderer } from "./static-renderer/StaticRichTextRenderer";

export function RichTextEditor({
	content,
	onChange,
	onReady,
	placeholder,
	className,
	ariaLabel,
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
	const [isLinkEditorOpen, setIsLinkEditorOpen] = useState(false);
	const openLinkEditor = useCallback(() => setIsLinkEditorOpen(true), []);
	const closeLinkEditor = useCallback(() => setIsLinkEditorOpen(false), []);
	const editor = useRichTextEditorInstance({
		content,
		placeholder,
		contentClassName,
		runtimeRefs,
		openMathSelection,
		mathSelectionRef,
		findInsertedMathSelection,
		syncImageInputFromTransaction,
		openLinkEditor,
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
		return (
			<StaticRichTextRenderer
				content={content}
				className={className}
				contentClassName={contentClassName}
			/>
		);
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
				isLinkEditorOpen={isLinkEditorOpen}
				onOpenLinkEditor={openLinkEditor}
				onCloseLinkEditor={closeLinkEditor}
			/>
			<EditorContent aria-label={ariaLabel} editor={editor} />
		</div>
	);
}
