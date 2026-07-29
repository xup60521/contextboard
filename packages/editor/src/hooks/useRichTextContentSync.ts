import type { Editor, JSONContent } from "@tiptap/core";
import { useEffect } from "react";

export function useRichTextContentSync({
	editor,
	content,
	syncContentOnPropChange,
}: {
	editor: Editor | null;
	content?: JSONContent | null;
	syncContentOnPropChange: boolean;
}) {
	useEffect(() => {
		if (!editor || !syncContentOnPropChange) {
			return;
		}

		editor.commands.setContent(content ?? "", { emitUpdate: false });
	}, [content, editor, syncContentOnPropChange]);
}
