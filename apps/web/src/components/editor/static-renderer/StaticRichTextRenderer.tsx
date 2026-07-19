import "katex/dist/katex.min.css";
import "../editor.css";

import type { JSONContent } from "@tiptap/core";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { type ReactNode, useEffect, useMemo } from "react";
import { cn } from "#/lib/utils";
import { createStaticRichTextExtensions } from "./createStaticRichTextExtensions";
import { createStaticRendererOptions } from "./staticRendererMappings";

export type StaticRichTextRendererProps = {
	content?: JSONContent | null;
	className?: string;
	contentClassName?: string;
	onOpenCardPreview?: (cardId: string) => void;
	emptyFallback?: ReactNode;
	onReady?: () => void;
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
	onReady,
}: StaticRichTextRendererProps) {
	// Signal once after mount so the host can measure the rendered content.
	// ResizeObserver on the host handles later reflows (web fonts, KaTeX).
	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount.
	useEffect(() => {
		onReady?.();
	}, []);

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
			style={{ pointerEvents: "none" }}
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
