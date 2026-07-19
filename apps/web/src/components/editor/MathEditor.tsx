import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { Trash2 } from "lucide-react";
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
	const popupRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

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
			onClose();
		}

		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [onClose]);

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
		onClose();
	}

	function closeAndFocus() {
		onClose();
		editor.commands.focus(undefined, { scrollIntoView: false });
	}

	return (
		<div
			ref={popupRef}
			className="fixed top-0 left-0 z-50 w-72 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-2 shadow-[0_18px_44px_rgba(23,58,64,0.18)] backdrop-blur-md transition-opacity"
			style={{ opacity: isPositioned ? 1 : 0 }}
		>
			<div className="relative">
				<textarea
					ref={textareaRef}
					value={latex}
					spellCheck={false}
					rows={type === "inline" ? 2 : 4}
					placeholder="e.g. \frac{a}{b}"
					onChange={(event) => applyLatex(event.target.value)}
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
					className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2 pr-7 pl-2.5 font-mono text-sm text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)]/60 focus:outline-none focus:border-[var(--sea-ink-soft)]"
				/>
				<button
					type="button"
					onClick={removeMath}
					title="Remove equation"
					aria-label="Remove equation"
					className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded text-[var(--sea-ink-soft)]/40 transition-colors hover:text-[var(--destructive)]"
				>
					<Trash2 className="size-3" />
				</button>
			</div>
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
