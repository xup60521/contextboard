import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MathSelection } from "./RichTextEditor.types";

export type { MathSelection } from "./RichTextEditor.types";

type MathEditorProps = {
	editor: Editor;
	selection: MathSelection;
	onClose: () => void;
};

export function MathEditor({ editor, selection, onClose }: MathEditorProps) {
	const { pos, type } = selection;
	const [latex, setLatex] = useState(selection.latex);
	const [isPositioned, setIsPositioned] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const isClosingRef = useRef(false);
	const popupRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Play the exit animation before actually unmounting.
	function requestClose() {
		if (isClosingRef.current) {
			return;
		}
		isClosingRef.current = true;
		setIsClosing(true);
	}

	useEffect(() => {
		if (!isClosing) {
			return;
		}
		const timer = setTimeout(onClose, 150);
		return () => clearTimeout(timer);
	}, [isClosing, onClose]);

	// Anchor the popover to the clicked math node.
	useLayoutEffect(() => {
		const popup = popupRef.current;
		if (!popup) {
			return;
		}

		let cancelled = false;
		setIsPositioned(false);

		computePosition(
			{ getBoundingClientRect: () => getMathAnchorRect(editor, pos) },
			popup,
			{
				placement: "bottom-start",
				strategy: "fixed",
				middleware: [offset(16), flip(), shift({ padding: 8 })],
			},
		).then(({ x, y }) => {
			if (cancelled) {
				return;
			}

			popup.style.left = `${x}px`;
			popup.style.top = `${y}px`;
			setIsPositioned(true);
		});

		return () => {
			cancelled = true;
		};
	}, [editor, pos]);

	// Focus the input when the editor opens.
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}

		textarea.focus({ preventScroll: true });
		textarea.setSelectionRange(0, textarea.value.length);
	}, []);

	// Grow the textarea to fit its content instead of scrolling internally.
	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}

		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, [latex]);

	// Close when clicking outside (but not on another math node, which reopens).
	useEffect(() => {
		function onPointerDown(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			if (!target) {
				return;
			}
			if (popupRef.current?.contains(target)) {
				return;
			}
			if (
				target.closest('[data-type="inline-math"], [data-type="block-math"]')
			) {
				return;
			}
			closeAndFocus();
		}

		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onClose, latex]);

	function applyLatex(next: string) {
		setLatex(next);
		if (type === "inline") {
			editor.chain().updateInlineMath({ latex: next, pos }).run();
		} else {
			editor.chain().updateBlockMath({ latex: next, pos }).run();
		}
	}

	function insertLineBreak(textarea: HTMLTextAreaElement) {
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const next = `${latex.slice(0, start)}\n${latex.slice(end)}`;

		applyLatex(next);
		requestAnimationFrame(() => {
			textarea.selectionStart = start + 1;
			textarea.selectionEnd = start + 1;
		});
	}

	function removeMath() {
		if (isClosingRef.current) {
			return;
		}
		if (type === "inline") {
			editor
				.chain()
				.deleteInlineMath({ pos })
				.focus(undefined, { scrollIntoView: false })
				.run();
		} else {
			editor
				.chain()
				.deleteBlockMath({ pos })
				.focus(undefined, { scrollIntoView: false })
				.run();
		}
		requestClose();
	}

	function closeAndFocus() {
		if (isClosingRef.current) {
			return;
		}
		if (latex.trim() === "") {
			removeMath();
			return;
		}
		editor.commands.focus(undefined, { scrollIntoView: false });
		requestClose();
	}

	return (
		<div
			ref={popupRef}
			className={`fixed top-0 left-0 z-50 w-96 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_14px_34px_rgba(23,58,64,0.18)] backdrop-blur-md transition-opacity duration-150 ${
				isClosing
					? "pointer-events-none animate-out fade-out-0 zoom-out-95"
					: "animate-in fade-in-0 zoom-in-95"
			}`}
			style={{ opacity: isPositioned ? 1 : 0 }}
		>
			<textarea
				ref={textareaRef}
				value={latex}
				spellCheck={false}
				rows={1}
				placeholder="e.g. \frac{a}{b}"
				onChange={(event) => applyLatex(event.target.value)}
				onWheel={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						closeAndFocus();
					}
					if (event.key === "Enter") {
						event.preventDefault();
						if (event.ctrlKey || event.shiftKey) {
							insertLineBreak(event.currentTarget);
							return;
						}
						closeAndFocus();
					}
				}}
				className={`w-full resize-none overflow-hidden border-none bg-transparent px-2.5 py-2 font-mono text-xs text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)]/60 focus:outline-none ${type === "inline" ? "min-h-9" : "min-h-16"}`}
			/>
		</div>
	);
}

function getMathAnchorRect(editor: Editor, pos: number): DOMRect {
	const node = editor.view.nodeDOM(pos);

	if (node instanceof Element) {
		return node.getBoundingClientRect();
	}

	const coords = editor.view.coordsAtPos(pos);
	return {
		width: Math.max(coords.right - coords.left, 1),
		height: Math.max(coords.bottom - coords.top, 1),
		x: coords.left,
		y: coords.top,
		top: coords.top,
		left: coords.left,
		right: coords.right,
		bottom: coords.bottom,
		toJSON() {},
	} satisfies DOMRect;
}
