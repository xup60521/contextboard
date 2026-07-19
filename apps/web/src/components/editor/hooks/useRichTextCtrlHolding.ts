import type { Editor } from "@tiptap/core";
import { type RefObject, useEffect } from "react";

export function useRichTextCtrlHolding({
	editor,
	containerRef,
}: {
	editor: Editor | null;
	containerRef: RefObject<HTMLDivElement | null>;
}) {
	useEffect(() => {
		if (!editor) return;

		function onKeyChange(event: KeyboardEvent) {
			const active = event.ctrlKey || event.metaKey;
			containerRef.current?.classList.toggle("ctrl-holding", active);
		}

		document.addEventListener("keydown", onKeyChange);
		document.addEventListener("keyup", onKeyChange);

		return () => {
			document.removeEventListener("keydown", onKeyChange);
			document.removeEventListener("keyup", onKeyChange);
		};
	}, [containerRef, editor]);
}
