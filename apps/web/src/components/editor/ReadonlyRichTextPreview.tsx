import type { JSONContent } from "@tiptap/core";
import { cn } from "#/lib/utils";
import type { CardReferenceSupport } from "./card-reference/types";
import { RichTextEditor } from "./RichTextEditor";

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
 * Compatibility wrapper around RichTextEditor for compact readonly surfaces.
 * Rendering stays identical to the editable editor; only editing and chrome are
 * disabled.
 */
export function ReadonlyRichTextPreview({
	content,
	className,
	contentClassName = "min-h-0 bg-transparent text-sm",
	cardReferenceSupport,
}: ReadonlyRichTextPreviewProps) {
	return (
		<RichTextEditor
			content={content}
			className={cn(className, "notion-editor seamless")}
			contentClassName={contentClassName}
			editable={false}
			showChrome={false}
			syncContentOnPropChange={true}
			cardReferenceSupport={cardReferenceSupport}
		/>
	);
}
