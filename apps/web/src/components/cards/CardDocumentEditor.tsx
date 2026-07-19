import type { JSONContent } from "@tiptap/core";
import type { ImageUploadHandler } from "#/components/editor/ImageUploadExtension";
import { RichTextEditor } from "#/components/editor/RichTextEditor";
import type { CardReferenceSupport } from "#/components/editor/card-reference/types";
import { useCardReferenceSupport } from "#/components/editor/useCardReferenceSupport";
import { useImageUpload } from "#/components/editor/useImageUpload";
import type { Id } from "../../../convex/_generated/dataModel";

export type CardDocumentEditorProps = {
	content: JSONContent | null;
	editable?: boolean;
	whiteboardId?: Id<"whiteboards"> | null;
	className?: string;
	contentClassName?: string;
	placeholder?: string;
	onChange?: (content: JSONContent) => void;
	onReady?: () => void;
	onOpenPreview?: (cardId: Id<"cards">) => void;
	defaultFocusPosition?: "start" | "end";
	selectContentOnFocus?: boolean;
	cardReferenceSupport?: CardReferenceSupport;
	onImageUpload?: ImageUploadHandler;
};

export function CardDocumentEditor({
	content,
	editable = true,
	whiteboardId,
	className,
	contentClassName,
	placeholder,
	onChange,
	onReady,
	onOpenPreview,
	defaultFocusPosition = "end",
	selectContentOnFocus = false,
	cardReferenceSupport,
	onImageUpload,
}: CardDocumentEditorProps) {
	const handleImageUpload = useImageUpload();
	const { support } = useCardReferenceSupport(whiteboardId, {
		onOpenPreview,
	});

	return (
		<RichTextEditor
			content={content}
			editable={editable}
			className={className}
			contentClassName={contentClassName}
			placeholder={placeholder}
			onChange={onChange}
			onReady={onReady}
			onImageUpload={onImageUpload ?? handleImageUpload}
			cardReferenceSupport={cardReferenceSupport ?? support}
			defaultFocusPosition={defaultFocusPosition}
			selectContentOnFocus={selectContentOnFocus}
		/>
	);
}
