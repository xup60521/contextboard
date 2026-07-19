import type { JSONContent } from "@tiptap/core";
import { CardDocumentEditor } from "#/components/cards/CardDocumentEditor";
import { useDebouncedCardSave } from "#/components/cards/useDebouncedCardSave";
import { useCardReferenceSupport } from "#/components/editor/useCardReferenceSupport";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import type { Id } from "../../../convex/_generated/dataModel";

type CardEditorPaneProps = {
	cardId: Id<"cards">;
	content: JSONContent;
	/** The current board context for empty-`@` recent-card suggestions. */
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
	const { support, previewCardId, closePreview } =
		useCardReferenceSupport(whiteboardId);
	const { scheduleSave } = useDebouncedCardSave(cardId, 450, {
		initialContent: content,
	});

	return (
		<>
			<CardDocumentEditor
				key={cardId}
				content={content}
				onChange={scheduleSave}
				onReady={onEditorReady}
				whiteboardId={whiteboardId}
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
