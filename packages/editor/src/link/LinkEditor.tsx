import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { Check, Unlink } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "../platform/utils";
import { activeLinkHref, applyLink, removeLink } from "./link-commands";

type LinkEditorProps = {
	editor: Editor;
	onClose: () => void;
};

/**
 * Anchors itself rather than riding TipTap's `BubbleMenu`: that plugin only
 * reveals itself while the editor holds focus and a transaction is in flight,
 * and this popover opens from a keyboard shortcut and then steals focus into
 * its input — so it would never be shown.
 */
export function LinkEditor({ editor, onClose }: LinkEditorProps) {
	const [href, setHref] = useState(() => activeLinkHref(editor));
	const [isPositioned, setIsPositioned] = useState(false);
	const popupRef = useRef<HTMLDivElement>(null);
	const isEditingExisting = editor.isActive("link");

	useLayoutEffect(() => {
		const popup = popupRef.current;
		if (!popup) return;

		let cancelled = false;
		computePosition(
			{ getBoundingClientRect: () => getSelectionRect(editor) },
			popup,
			{
				placement: "bottom-start",
				strategy: "fixed",
				middleware: [offset(8), flip(), shift({ padding: 8 })],
			},
		).then(({ x, y }) => {
			if (cancelled) return;

			popup.style.left = `${x}px`;
			popup.style.top = `${y}px`;
			setIsPositioned(true);
		});

		return () => {
			cancelled = true;
		};
	}, [editor]);

	// Focusing before `onClose` would be undone by the unmount: removing the
	// focused input drops focus to the body. Hand it back once React has let go.
	const closeAndFocus = useCallback(() => {
		onClose();
		requestAnimationFrame(() =>
			editor.commands.focus(undefined, { scrollIntoView: false }),
		);
	}, [editor, onClose]);

	// Anywhere outside dismisses, which is also how a click back into the text
	// cancels — the editor keeps its selection either way.
	useEffect(() => {
		function onPointerDown(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			if (target && popupRef.current?.contains(target)) return;
			onClose();
		}

		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [onClose]);

	// Escape is claimed on the document instead of on the input. The card shell
	// and any surrounding dialog read it as "close me" too, and they listen in
	// the capture phase — so an input-level handler either never runs, or runs
	// and still lets the card exit editing. The innermost layer should win.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;

			event.preventDefault();
			event.stopPropagation();
			closeAndFocus();
		}

		document.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			document.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [closeAndFocus]);

	function commit() {
		if (href.trim()) {
			applyLink(editor, href);
		} else if (isEditingExisting) {
			removeLink(editor);
		}
		closeAndFocus();
	}

	return (
		<div
			ref={popupRef}
			className="fixed top-0 left-0 z-50 flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] p-1 shadow-[0_14px_34px_rgba(23,58,64,0.18)] backdrop-blur-md"
			style={{ opacity: isPositioned ? 1 : 0 }}
		>
			<input
				type="text"
				value={href}
				onChange={(event) => setHref(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					}
				}}
				placeholder="Paste a link and press Enter..."
				aria-label="Link URL"
				className="w-64 bg-transparent px-2 text-sm text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]"
				// biome-ignore lint/a11y/noAutofocus: the popover exists to be typed in
				autoFocus
			/>
			<LinkEditorButton icon={Check} label="Apply link" onClick={commit} />
			{isEditingExisting && (
				<LinkEditorButton
					icon={Unlink}
					label="Remove link"
					onClick={() => {
						removeLink(editor);
						closeAndFocus();
					}}
				/>
			)}
		</div>
	);
}

/** Screen rect of whatever the popover is about to turn into a link. */
function getSelectionRect(editor: Editor): DOMRect {
	const { from, to } = editor.state.selection;
	const start = editor.view.coordsAtPos(from);
	const end = editor.view.coordsAtPos(to);

	const left = Math.min(start.left, end.left);
	const right = Math.max(start.right, end.right);
	const top = Math.min(start.top, end.top);
	const bottom = Math.max(start.bottom, end.bottom);

	return {
		x: left,
		y: top,
		left,
		right,
		top,
		bottom,
		width: Math.max(right - left, 1),
		height: Math.max(bottom - top, 1),
		toJSON() {},
	} satisfies DOMRect;
}

function LinkEditorButton({
	icon: Icon,
	label,
	onClick,
}: {
	icon: typeof Check;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className={cn(
				"flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
				"text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]",
			)}
		>
			<Icon className="size-4" />
		</button>
	);
}
