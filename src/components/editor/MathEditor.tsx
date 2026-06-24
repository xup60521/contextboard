import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MathSelection = {
	pos: number;
	type: "inline" | "block";
	latex: string;
};

type MathEditorProps = {
	editor: Editor;
	selection: MathSelection;
	onClose: () => void;
};

export function MathEditor({ editor, selection, onClose }: MathEditorProps) {
	const { pos, type } = selection;
	const [latex, setLatex] = useState(selection.latex);
	const popupRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Anchor the popover to the clicked math node.
	useLayoutEffect(() => {
		const popup = popupRef.current;
		if (!popup) {
			return;
		}

		const coords = editor.view.coordsAtPos(pos);
		const rect = {
			width: coords.right - coords.left,
			height: coords.bottom - coords.top,
			x: coords.left,
			y: coords.top,
			top: coords.top,
			left: coords.left,
			right: coords.right,
			bottom: coords.bottom,
			toJSON() {},
		} satisfies DOMRect;

		computePosition({ getBoundingClientRect: () => rect }, popup, {
			placement: "bottom-start",
			strategy: "fixed",
			middleware: [offset(8), flip(), shift({ padding: 8 })],
		}).then(({ x, y }) => {
			popup.style.left = `${x}px`;
			popup.style.top = `${y}px`;
		});
	}, [editor, pos]);

	// Focus the input when the editor opens.
	useEffect(() => {
		const textarea = textareaRef.current;
		textarea?.focus();
		textarea?.select();
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

	function removeMath() {
		if (type === "inline") {
			editor.chain().focus().deleteInlineMath({ pos }).run();
		} else {
			editor.chain().focus().deleteBlockMath({ pos }).run();
		}
		onClose();
	}

	function closeAndFocus() {
		onClose();
		editor.commands.focus();
	}

	return (
		<div
			ref={popupRef}
			className="fixed top-0 left-0 z-50 w-80 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-3 shadow-[0_18px_44px_rgba(23,58,64,0.18)] backdrop-blur-md"
		>
			<div className="mb-1.5 flex items-center justify-between">
				<span className="text-xs font-semibold tracking-wide text-[var(--sea-ink-soft)] uppercase">
					{type === "inline" ? "Inline math" : "Block math"} · LaTeX
				</span>
				<button
					type="button"
					onClick={removeMath}
					title="Remove equation"
					aria-label="Remove equation"
					className="flex size-6 items-center justify-center rounded-md text-[var(--sea-ink-soft)] transition-colors hover:bg-[var(--link-bg-hover)] hover:text-[var(--destructive)]"
				>
					<Trash2 className="size-3.5" />
				</button>
			</div>
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
					if (event.key === "Enter" && type === "inline" && !event.shiftKey) {
						event.preventDefault();
						closeAndFocus();
					}
				}}
				className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 font-mono text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon)]"
			/>
			<p className="mt-1.5 text-[11px] text-[var(--sea-ink-soft)]">
				Preview updates live · Esc to close
			</p>
		</div>
	);
}
