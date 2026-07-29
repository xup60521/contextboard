import type { Editor } from "@tiptap/core";
import type { RefObject } from "react";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
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
};

export function RichTextEditorChrome({
	editor,
	editable,
	showChrome,
	containerRef,
	imageInputPos,
	mathSelection,
	onCloseMathEditor,
}: RichTextEditorChromeProps) {
	if (!showChrome || !editable) {
		return null;
	}

	return (
		<>
			<EditorBubbleMenu editor={editor} />
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
