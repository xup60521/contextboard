import { useMutation } from "#/integrations/local/react";
import { useCallback } from "react";
import { api } from "#/integrations/local/api";
import { uploadImageLocally, type UploadedImage } from "./ImageUpload";

/**
 * Returns a stable `(file) => Promise<url>` callback that uploads an image to
 * local blob storage and resolves to a stable embedded serving URL.
 * Shared by the card editor and the whiteboard markdown card so the upload
 * logic lives in one place.
 */
export function useImageUpload(): (file: File) => Promise<UploadedImage> {
	const generateUploadUrl = useMutation(api.files.generateUploadUrl);
	const finalizeUpload = useMutation(api.files.finalizeUpload);

	return useCallback(
		(file: File) =>
			uploadImageLocally(generateUploadUrl, finalizeUpload, file),
		[finalizeUpload, generateUploadUrl],
	);
}
