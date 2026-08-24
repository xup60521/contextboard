import type { Editor } from "@tiptap/core";
import type { RefObject } from "react";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { LinkEditor } from "./link/LinkEditor";
import { MathEditor } from "./MathEditor";
import type { MathSelection } from "./RichTextEditor.types";
import { ImageCommand } from "./slash/ImageCommand";
import { TableHandlesOverlay } from "./table/TableHandlesOverlay";

export type RichTextEditorChromeProps = {
	editor: Editor;
	editable: boolean;
	showChrome: boolean;
	containerRef: RefObject<HTMLDivElement | null>;
	imageInputPos: number | null;
	mathSelection: MathSelection | null;
	onCloseMathEditor: () => void;
	isLinkEditorOpen: boolean;
	onOpenLinkEditor: () => void;
	onCloseLinkEditor: () => void;
};

export function RichTextEditorChrome({
	editor,
	editable,
	showChrome,
	containerRef,
	imageInputPos,
	mathSelection,
	onCloseMathEditor,
	isLinkEditorOpen,
	onOpenLinkEditor,
	onCloseLinkEditor,
}: RichTextEditorChromeProps) {
	if (!showChrome || !editable) {
		return null;
	}

	return (
		<>
			{/* Unmounting is what actually hides the bubble menu: its `shouldShow`
			    is only re-read on a transaction, and opening the link editor is not
			    one. */}
			{isLinkEditorOpen ? (
				<LinkEditor editor={editor} onClose={onCloseLinkEditor} />
			) : (
				<EditorBubbleMenu editor={editor} onOpenLinkEditor={onOpenLinkEditor} />
			)}
			<TableHandlesOverlay editor={editor} containerRef={containerRef} />
			{imageInputPos !== null && <ImageCommand editor={editor} />}
			{mathSelection && (
				<MathEditor
					key={mathSelection.pos}
					editor={editor}
					selection={mathSelection}
					onClose={onCloseMathEditor}
				/>
			)}
		</>
	);
}
