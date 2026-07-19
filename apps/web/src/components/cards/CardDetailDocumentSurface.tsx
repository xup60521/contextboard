import type { JSONContent } from "@tiptap/core";
import { useCardReferenceSupport } from "#/components/editor/useCardReferenceSupport";
import {
	useDeferredEditorMount,
} from "#/components/editor/useDeferredEditorMount";
import { ReadonlyRichTextPreview } from "#/components/editor/ReadonlyRichTextPreview";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import type { Id } from "#/integrations/local/types";
import { CardEditorPane } from "../editor/CardEditorPane";

type CardDetailDocumentSurfaceProps = {
	cardId: Id<"cards">;
	content: JSONContent;
	whiteboardId: Id<"whiteboards"> | null;
};

export function CardDetailDocumentSurface({
	cardId,
	content,
	whiteboardId,
}: CardDetailDocumentSurfaceProps) {
	const { support, previewCardId, closePreview } =
		useCardReferenceSupport(whiteboardId);
	const { shouldMountEditor, promoteMount } = useDeferredEditorMount(cardId, true);

	return (
		<>
			{shouldMountEditor ? (
				<CardEditorPane
					cardId={cardId}
					content={content}
					whiteboardId={whiteboardId}
				/>
			) : (
				<div
					data-testid="card-detail-renderer"
					onPointerDownCapture={promoteMount}
					onFocusCapture={promoteMount}
					onKeyDownCapture={promoteMount}
				>
					<ReadonlyRichTextPreview
						content={content}
						contentClassName="min-h-[60vh] bg-[var(--bg-base)]"
						cardReferenceSupport={support}
					/>
				</div>
			)}
			<CardPreviewDialog
				cardId={previewCardId}
				currentWhiteboardId={whiteboardId}
				onClose={closePreview}
			/>
		</>
	);
}
