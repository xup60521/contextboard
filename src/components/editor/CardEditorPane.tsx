import type { JSONContent } from "@tiptap/core";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { RichTextEditor } from "#/components/editor/RichTextEditor";
import { useCardReferenceSupport } from "#/components/editor/useCardReferenceSupport";
import { useImageUpload } from "#/components/editor/useImageUpload";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type CardEditorPaneProps = {
	cardId: Id<"cards">;
	content: JSONContent;
	/** The card's home whiteboard, used for the empty-`@` recent-cards context. */
	whiteboardId?: Id<"whiteboards"> | null;
	className?: string;
	contentClassName?: string;
	onEditorReady?: () => void;
};

/**
 * Renders a card's rich-text editor with debounced auto-save. Shared by the
 * full card page (`/cards/$cardId`) and the search preview popup so the save
 * logic lives in one place.
 */
export function CardEditorPane({
	cardId,
	content,
	whiteboardId,
	className = "notion-editor seamless",
	contentClassName = "min-h-[60vh] bg-[var(--bg-base)]",
	onEditorReady,
}: CardEditorPaneProps) {
	const updateContent = useMutation(api.cards.updateContent);
	const handleImageUpload = useImageUpload();
	const { support, previewCardId, closePreview } =
		useCardReferenceSupport(whiteboardId);
	const pendingContentRef = useRef<JSONContent | null>(null);
	const saveTimerRef = useRef<number | null>(null);

	const flushSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const content = pendingContentRef.current;
		pendingContentRef.current = null;
		if (!content) return;

		void updateContent({ cardId, content });
	}, [cardId, updateContent]);

	const scheduleSave = useCallback(
		(content: JSONContent) => {
			pendingContentRef.current = content;

			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}

			saveTimerRef.current = window.setTimeout(flushSave, 450);
		},
		[flushSave],
	);

	useEffect(() => {
		return () => {
			flushSave();
		};
	}, [flushSave]);

	return (
		<>
			<RichTextEditor
				key={cardId}
				content={content}
				onChange={scheduleSave}
				onReady={onEditorReady}
				onImageUpload={handleImageUpload}
				cardReferenceSupport={support}
				className={className}
				contentClassName={contentClassName}
			/>
			<CardPreviewDialog
				cardId={previewCardId}
				currentWhiteboardId={whiteboardId ?? null}
				onClose={closePreview}
			/>
		</>
	);
}
