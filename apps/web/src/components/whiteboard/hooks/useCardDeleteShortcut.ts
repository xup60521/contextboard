import { useEffect, useState } from "react";
import type { Editor } from "tldraw";
import type { Id } from "#/integrations/local/types";
import {
	collectGlobalDeleteCardIdsFromShapes,
	isEditableKeyboardTarget,
	isGlobalCardDeleteShortcut,
} from "../whiteboard-canvas-helpers";

export function useCardDeleteShortcut({ editor }: { editor: Editor | null }) {
	const [whiteboardCardDeletePending, setWhiteboardCardDeletePending] =
		useState<{ cardIds: Id<"cards">[] } | null>(null);

	// Ctrl+Delete: confirm permanent delete for selected markdown cards.
	useEffect(() => {
		if (!editor) return;

		const ownerDocument = editor.getContainer().ownerDocument;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isGlobalCardDeleteShortcut(event)) return;
			if (editor.getEditingShapeId()) return;
			if (isEditableKeyboardTarget(event.target)) return;
			if (whiteboardCardDeletePending) return;

			const cardIds = collectGlobalDeleteCardIdsFromShapes(
				editor.getSelectedShapes(),
			);

			if (cardIds.length === 0) return;

			event.preventDefault();
			event.stopPropagation();

			setWhiteboardCardDeletePending({ cardIds });
		};

		ownerDocument.addEventListener("keydown", handleKeyDown, true);

		return () => {
			ownerDocument.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [editor, whiteboardCardDeletePending]);

	return { whiteboardCardDeletePending, setWhiteboardCardDeletePending };
}
