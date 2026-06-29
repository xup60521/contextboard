import "katex/dist/katex.min.css";
import "../editor.css";

import type { JSONContent } from "@tiptap/core";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { type ReactNode, useMemo } from "react";
import { cn } from "#/lib/utils";
import { createStaticRichTextExtensions } from "./createStaticRichTextExtensions";
import { createStaticRendererOptions } from "./staticRendererMappings";

export type StaticRichTextRendererProps = {
	content?: JSONContent | null;
	className?: string;
	contentClassName?: string;
	onOpenCardPreview?: (cardId: string) => void;
	emptyFallback?: ReactNode;
};

const EMPTY_DOC: JSONContent = {
	type: "doc",
	content: [],
};

export function StaticRichTextRenderer({
	content,
	className,
	contentClassName = "min-h-0 bg-transparent text-sm",
	onOpenCardPreview,
	emptyFallback = null,
}: StaticRichTextRendererProps) {
	const rendered = useMemo(() => {
		const doc = content ?? EMPTY_DOC;

		if (!doc.content?.length) {
			return emptyFallback;
		}

		return renderToReactElement({
			extensions: createStaticRichTextExtensions(),
			content: doc,
			options: createStaticRendererOptions({
				onOpenCardPreview,
			}),
		});
	}, [content, emptyFallback, onOpenCardPreview]);

	return (
		<div
			className={cn(
				className,
				"notion-editor seamless rich-text-editor-shell relative",
			)}
		>
			<div
				className={cn(
					"tiptap prose dark:prose-invert max-w-none focus:outline-none",
					contentClassName,
				)}
				data-static-rich-text-renderer="true"
			>
				{rendered}
			</div>
		</div>
	);
}
