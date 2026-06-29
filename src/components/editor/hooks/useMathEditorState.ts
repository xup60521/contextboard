import { useCallback, useRef, useState } from "react";
import { findInsertedMathSelection } from "../math-selection";
import type { MathSelection } from "../RichTextEditor.types";

export function useMathEditorState() {
	const [mathSelection, setMathSelection] = useState<MathSelection | null>(
		null,
	);
	const mathSelectionRef = useRef<MathSelection | null>(null);

	const openMathSelection = useCallback((selection: MathSelection | null) => {
		mathSelectionRef.current = selection;
		setMathSelection(selection);
	}, []);

	return {
		mathSelection,
		mathSelectionRef,
		openMathSelection,
		findInsertedMathSelection,
	};
}
