import { useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "../../../convex/_generated/api";
import { uploadImageToConvex, type UploadedImage } from "./ImageUpload";

/**
 * Returns a stable `(file) => Promise<url>` callback that uploads an image to
 * Convex file storage and resolves to its (stable, non-expiring) serving URL.
 * Shared by the card editor and the whiteboard markdown card so the upload
 * logic lives in one place.
 */
export function useImageUpload(): (file: File) => Promise<UploadedImage> {
	const generateUploadUrl = useMutation(api.files.generateUploadUrl);
	const finalizeUpload = useMutation(api.files.finalizeUpload);

	return useCallback(
		(file: File) =>
			uploadImageToConvex(generateUploadUrl, finalizeUpload, file),
		[finalizeUpload, generateUploadUrl],
	);
}
