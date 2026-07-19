import type { Editor } from "@tiptap/core";
import { type RefObject, useEffect, useRef } from "react";

export function useRichTextReady({
	editor,
	onReady,
	containerRef,
}: {
	editor: Editor | null;
	onReady?: () => void;
	containerRef: RefObject<HTMLDivElement | null>;
}) {
	const didNotifyReadyRef = useRef(false);

	useEffect(() => {
		if (!editor || !onReady || didNotifyReadyRef.current) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			if (didNotifyReadyRef.current) {
				return;
			}

			if (!containerRef.current?.querySelector(".ProseMirror")) {
				return;
			}

			didNotifyReadyRef.current = true;
			onReady();
		});

		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [containerRef, editor, onReady]);
}
