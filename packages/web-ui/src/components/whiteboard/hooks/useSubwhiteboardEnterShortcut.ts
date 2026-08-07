import { useEffect } from "react";
import type { Editor } from "tldraw";
import type { WhiteboardNavigation } from "../navigation";
import {
	isEditableKeyboardTarget,
	isSubwhiteboardEnterShortcut,
	isSubwhiteboardLinkShape,
	openSubwhiteboardShape,
} from "../whiteboard-canvas-helpers";

export function useSubwhiteboardEnterShortcut({
	editor,
	navigate,
}: {
	editor: Editor | null;
	navigate: WhiteboardNavigation;
}) {
	// Enter: navigate into the selected sub-whiteboard link, matching the
	// existing double-click / context-menu "enter" behavior.
	useEffect(() => {
		if (!editor) return;

		const ownerDocument = editor.getContainer().ownerDocument;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isSubwhiteboardEnterShortcut(event)) return;
			if (editor.getEditingShapeId()) return;
			if (isEditableKeyboardTarget(event.target)) return;

			const only = editor.getOnlySelectedShape();
			if (!only || !isSubwhiteboardLinkShape(only)) return;
			if (!only.props.childWhiteboardId) return;

			event.preventDefault();
			event.stopPropagation();

			openSubwhiteboardShape(navigate, only);
		};

		ownerDocument.addEventListener("keydown", handleKeyDown, true);

		return () => {
			ownerDocument.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [editor, navigate]);
}
