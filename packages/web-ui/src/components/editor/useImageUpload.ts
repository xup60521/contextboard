import { fileSrc, useApplicationRuntime } from "@contextboard/application";
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
			return {
				fileId: descriptor.fileId,
				src: fileSrc(descriptor.fileId),
				storageId: descriptor.fileId,
			};
		},
		[files],
	);
}
