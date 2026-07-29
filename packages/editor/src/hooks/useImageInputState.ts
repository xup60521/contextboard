import type { Editor } from "@tiptap/core";
import { useCallback, useRef, useState } from "react";
import { imageInputPluginKey } from "../ImageInputExtension";

export function useImageInputState() {
	const [imageInputPos, setImageInputPos] = useState<number | null>(null);
	const imageInputPosRef = useRef<number | null>(null);

	const syncFromEditorTransaction = useCallback((editor: Editor) => {
		const imgState = imageInputPluginKey.getState(editor.state);
		const imgPos = imgState?.pos ?? null;

		if (imgPos !== imageInputPosRef.current) {
			imageInputPosRef.current = imgPos;
			setImageInputPos(imgPos);
		}
	}, []);

	const clearImageInput = useCallback((editor: Editor) => {
		if (imageInputPosRef.current === null) {
			return;
		}

		imageInputPosRef.current = null;
		setImageInputPos(null);
		editor.view.dispatch(
			editor.state.tr.setMeta(imageInputPluginKey, { pos: null }),
		);
	}, []);

	return {
		imageInputPos,
		imageInputPosRef,
		syncFromEditorTransaction,
		clearImageInput,
	};
}
