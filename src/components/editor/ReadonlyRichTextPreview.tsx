import "katex/dist/katex.min.css";
import "./editor.css";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect } from "react";
import { cn } from "#/lib/utils";
import type { CardReferenceSupport } from "./card-reference/types";
import { createRichTextExtensions } from "./createRichTextExtensions";

type ReadonlyRichTextPreviewProps = {
	/** TipTap JSON content to render. */
	content?: JSONContent | null;
	/** Additional classes for the outer wrapper. */
	className?: string;
	/** Additional classes for the ProseMirror content surface. */
	contentClassName?: string;
	/** Optional card-reference support for modifier-click preview. */
	cardReferenceSupport?: CardReferenceSupport;
};

/**
 * A lightweight, read-only TipTap surface that renders the same rich content
 * as the full editor — including KaTeX math, tables, details, images, and
 * card-reference links — without editing behavior, autosave, or editor UI.
 *
 * Designed for the search panel preview pane where rendering fidelity matters
 * but editing capabilities are not needed.
 */
export function ReadonlyRichTextPreview({
	content,
	className,
	contentClassName = "min-h-0 bg-transparent text-sm",
	cardReferenceSupport,
}: ReadonlyRichTextPreviewProps) {
	const extensions = createRichTextExtensions({
		mode: "readonly",
		cardReferenceSupport,
	});

	const editor = useEditor({
		immediatelyRender: false,
		editable: false,
		extensions,
		content: content ?? "",
		editorProps: {
			attributes: {
				class: `prose dark:prose-invert max-w-none focus:outline-none ${contentClassName}`,
			},
		},
	});

	useEffect(() => {
		if (!editor) {
			return;
		}

		editor.commands.setContent(content ?? "", false);
	}, [content, editor]);

	if (!editor) {
		return null;
	}

	return (
		<div className={cn(className, "notion-editor seamless")}>
			<EditorContent editor={editor} />
		</div>
	);
}
