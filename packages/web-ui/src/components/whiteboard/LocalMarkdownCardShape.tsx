import {
	DEFAULT_CARD_CONTENT,
	normalizeImageSources,
	serializeCardContent,
} from "@contextboard/application";
import { RichTextEditor, StaticRichTextRenderer } from "@contextboard/editor";
import type { JSONContent } from "@tiptap/core";
import { useEffect } from "react";
import { stopEventPropagation, useIsEditing } from "tldraw";
import { useCardContentEntry, useCardContentStore } from "./card-content-store";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import {
	isEmptyCardContent,
	MarkdownCardOpenLink,
	MarkdownCardShell,
} from "./MarkdownCardShell";
import { useMarkdownCardAutoHeight } from "./useMarkdownCardAutoHeight";

const MIN_HEIGHT = 64;

export function LocalMarkdownCardComponent({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const isEditing = useIsEditing(shape.id);
	const contentStore = useCardContentStore();
	const contentEntry = useCardContentEntry(shape.id);
	const initialContent = DEFAULT_CARD_CONTENT as JSONContent;
	const currentContent = contentEntry.draft ?? initialContent;
	useEffect(() => {
		if (contentEntry.status !== "idle") return;
		contentStore.setDraft(
			shape.id,
			initialContent,
			serializeCardContent(initialContent),
		);
	}, [contentEntry.status, contentStore, shape.id]);
	const staticContent = currentContent;
	const { cardRef, setIsContentReady } = useMarkdownCardAutoHeight({
		shape,
		minHeight: MIN_HEIGHT,
		isEditing,
	});
	const selectInitialContent = isEmptyCardContent(currentContent);

	return (
		<MarkdownCardShell
			shape={shape}
			isEditing={isEditing}
			className="h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]"
			contentRef={cardRef}
			contentClassName="w-full"
			header={
				<div
					className="flex items-center justify-end border-b border-[var(--border)] px-2 py-1"
					style={{ pointerEvents: "auto" }}
					onPointerDown={(e) => {
						if (isEditing) stopEventPropagation(e);
					}}
				>
					<MarkdownCardOpenLink
						href="/test/markdown"
						className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
					/>
				</div>
			}
		>
			<div className="px-8 py-8">
				{isEditing ? (
					<RichTextEditor
						editable
						content={currentContent}
						contentClassName="min-h-6"
						placeholder="Type '/' for commands"
						onChange={(value) => {
							const content = normalizeImageSources(value);
							contentStore.setDraft(
								shape.id,
								content,
								serializeCardContent(content),
							);
						}}
						onReady={() => setIsContentReady(true)}
						defaultFocusPosition={selectInitialContent ? "start" : "end"}
						selectContentOnFocus={selectInitialContent}
					/>
				) : (
					<StaticRichTextRenderer
						content={staticContent}
						contentClassName="min-h-6"
						onReady={() => setIsContentReady(true)}
					/>
				)}
			</div>
		</MarkdownCardShell>
	);
}
