import { useApplicationRuntime } from "@contextboard/application";
import type { UploadedImage } from "@contextboard/editor";
import { useCallback } from "react";

/**
 * Returns a stable `(file) => Promise<UploadedImage>` callback that stores an
 * image through the platform's blob capability and resolves to a stable
 * serving URL. Shared by the card editor and the whiteboard markdown card so
 * the upload logic lives in one place.
 */
export function useImageUpload(): (file: File) => Promise<UploadedImage> {
	const { files } = useApplicationRuntime();

	return useCallback(
		async (file: File) => {
			if (!files) throw new Error("This platform cannot store files");
			const descriptor = await files.upload(file);
			const src = await files.resolveUrl(descriptor.fileId);
			if (!src) throw new Error("The uploaded image could not be resolved");
			return {
				fileId: descriptor.fileId,
				src,
				storageId: descriptor.fileId,
			};
		},
		[files],
	);
}
