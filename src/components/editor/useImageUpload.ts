import { useConvex, useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "../../../convex/_generated/api";
import { uploadImageToConvex } from "./ImageUpload";

/**
 * Returns a stable `(file) => Promise<url>` callback that uploads an image to
 * Convex file storage and resolves to its (stable, non-expiring) serving URL.
 * Shared by the card editor and the whiteboard markdown card so the upload
 * logic lives in one place.
 */
export function useImageUpload(): (file: File) => Promise<string> {
	const generateUploadUrl = useMutation(api.files.generateUploadUrl);
	const convex = useConvex();

	return useCallback(
		(file: File) =>
			uploadImageToConvex(
				generateUploadUrl,
				(args) => convex.query(api.files.getImageUrl, args),
				file,
			),
		[generateUploadUrl, convex],
	);
}
