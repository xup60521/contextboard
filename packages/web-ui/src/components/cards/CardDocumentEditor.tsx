import {
	RichTextEditor,
	type CardReferenceRuntime,
	type ImageUploadRuntime,
} from "@contextboard/editor";
import {
	fileSrc,
	useApplicationRuntime,
} from "@contextboard/application";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useMemo } from "react";
import { useResolvedCardContent } from "./useResolvedCardContent";

export type CardDocumentEditorProps = {
	cardId?: string;
	whiteboardId?: string | null;
	content: JSONContent | null;
	editable?: boolean;
	className?: string;
	contentClassName?: string;
	placeholder?: string;
	onChange?: (content: JSONContent) => void;
	onReady?: () => void;
	onOpenPreview?: {
		bivarianceHack(cardId: string): void;
	}["bivarianceHack"];
	defaultFocusPosition?: "start" | "end";
	selectContentOnFocus?: boolean;
	cardReferenceSupport?: CardReferenceRuntime;
	onImageUpload?: ImageUploadRuntime;
};

export function CardDocumentEditor({
	cardId,
	whiteboardId: _whiteboardId,
	content,
	editable = true,
	onOpenPreview,
	cardReferenceSupport,
	onImageUpload,
	...props
}: CardDocumentEditorProps) {
	const runtime = useApplicationRuntime();
	const resolvedContent = useResolvedCardContent(content ?? { type: "doc" });
	const upload = useCallback<ImageUploadRuntime>(
		async (file) => {
			if (!runtime.files) throw new Error("File storage is unavailable.");
			const descriptor = await runtime.files.upload(file);
			return {
				fileId: descriptor.fileId,
				storageId: descriptor.fileId,
				src: fileSrc(descriptor.fileId),
			};
		},
		[runtime.files],
	);
	const references = useMemo<CardReferenceRuntime>(
		() => ({
			search: (query) =>
				runtime.cards.search({
					query,
					excludeCardId: cardId,
				}),
			onOpenPreview: (id) => onOpenPreview?.(id),
		}),
		[cardId, onOpenPreview, runtime.cards],
	);

	return (
		<RichTextEditor
			content={content ? resolvedContent : null}
			editable={editable}
			onImageUpload={onImageUpload ?? (runtime.files ? upload : undefined)}
			cardReferenceSupport={cardReferenceSupport ?? references}
			{...props}
		/>
	);
}
