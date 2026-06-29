import { useRef } from "react";
import type { CardReferenceSupport } from "../card-reference/types";
import type { ImageUploadHandler } from "../ImageUploadExtension";
import type { RichTextRuntimeRefs } from "../RichTextEditor.types";

export function useRichTextRuntimeRefs({
	editable,
	onImageUpload,
	cardReferenceSupport,
}: {
	editable: boolean;
	onImageUpload?: ImageUploadHandler;
	cardReferenceSupport?: CardReferenceSupport;
}): RichTextRuntimeRefs {
	const editableRef = useRef(editable);
	editableRef.current = editable;

	const onImageUploadRef = useRef(onImageUpload);
	onImageUploadRef.current = onImageUpload;

	const cardReferenceSupportRef = useRef(cardReferenceSupport);
	cardReferenceSupportRef.current = cardReferenceSupport;

	return {
		editableRef,
		onImageUploadRef,
		cardReferenceSupportRef,
	};
}
