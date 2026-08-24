import type { Editor } from "@tiptap/core";
import { toSafeHref } from "./href";

/**
 * Card references are ordinary `link` marks carrying `data-*` identity, so link
 * editing has to leave them alone — rewriting the href would orphan the
 * reference while the metadata still claims a card.
 */
export function isCardReferenceLink(editor: Editor): boolean {
	const attrs = editor.getAttributes("link");
	return Boolean(attrs.cardId || attrs.whiteboardRefId);
}

/** Href of the link under the cursor, if any. */
export function activeLinkHref(editor: Editor): string {
	const href = editor.getAttributes("link").href;
	return typeof href === "string" ? href : "";
}

/**
 * Normalizes what a user typed into an href we are willing to store: bare
 * domains become https, unsupported schemes are rejected.
 */
export function normalizeLinkInput(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const safe = toSafeHref(trimmed);
	if (safe) return safe;

	return /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
		? undefined
		: `https://${trimmed}`;
}

/** Applies the href to the whole link under the cursor, or the selection. */
export function applyLink(editor: Editor, value: string): boolean {
	const href = normalizeLinkInput(value);
	if (!href) return false;

	// With nothing selected and no link to rewrite there is no text to carry the
	// mark, so the href becomes its own label.
	if (editor.state.selection.empty && !editor.isActive("link")) {
		return editor
			.chain()
			.focus()
			.insertContent({
				type: "text",
				text: href,
				marks: [{ type: "link", attrs: { href } }],
			})
			.run();
	}

	return editor
		.chain()
		.focus()
		.extendMarkRange("link")
		.setLink({ href })
		.run();
}

/** Removes the whole link under the cursor, keeping its text. */
export function removeLink(editor: Editor): boolean {
	return editor.chain().focus().extendMarkRange("link").unsetLink().run();
}
