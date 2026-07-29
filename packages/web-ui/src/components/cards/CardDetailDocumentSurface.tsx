import { ReadonlyRichTextPreview, useDeferredEditorMount } from "@contextboard/editor";
import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import { CardDocumentEditor } from "./CardDocumentEditor";
import { CardPreviewDialog } from "./CardPreviewDialog";
import { useDebouncedCardSave } from "./useDebouncedCardSave";
import { useResolvedCardContent } from "./useResolvedCardContent";

export function CardDetailDocumentSurface({
	cardId,
	content,
	version,
	whiteboardId,
}: {
	cardId: string;
	content: JSONContent;
	version: number;
	whiteboardId: string | null;
}) {
	const [previewCardId, setPreviewCardId] = useState<string | null>(null);
	const { shouldMountEditor, promoteMount } = useDeferredEditorMount(cardId, true);
	const resolvedContent = useResolvedCardContent(content);
	const save = useDebouncedCardSave(cardId, 450, {
		initialContent: content,
		initialVersion: version,
	});

	return (
		<>
			{save.error ? (
				<div role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
					{save.error.message}
				</div>
			) : null}
			{shouldMountEditor ? (
				<CardDocumentEditor
					key={cardId}
					cardId={cardId}
					content={resolvedContent}
					onChange={save.scheduleSave}
					onOpenPreview={setPreviewCardId}
					className="notion-editor seamless"
					contentClassName="min-h-[60vh] bg-[var(--bg-base)]"
				/>
			) : (
				<div
					data-testid="card-detail-renderer"
					onPointerDownCapture={promoteMount}
					onFocusCapture={promoteMount}
					onKeyDownCapture={promoteMount}
				>
					<ReadonlyRichTextPreview
						content={resolvedContent}
						contentClassName="min-h-[60vh] bg-[var(--bg-base)]"
					/>
				</div>
			)}
			<CardPreviewDialog
				cardId={previewCardId}
				currentWhiteboardId={whiteboardId}
				onClose={() => setPreviewCardId(null)}
			/>
		</>
	);
}
