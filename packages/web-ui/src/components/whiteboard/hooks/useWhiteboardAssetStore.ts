import { useMemo } from "react";
import type { TLAssetStore } from "tldraw";
import type { Id } from "../ids";
import { uploadImageLocally } from "@contextboard/editor";

export function useWhiteboardAssetStore({
	generateUploadUrl,
	finalizeUpload,
}: {
	generateUploadUrl: () => Promise<string>;
	finalizeUpload: (args: { storageId: Id<"_storage"> }) => Promise<{
		fileId: Id<"files">;
		storageId: Id<"_storage">;
		url: string;
	}>;
}): TLAssetStore {
	return useMemo<TLAssetStore>(
		() => ({
			async upload(_asset, file) {
				// The shared editor brands ids optionally; Web brands them strictly.
				// The runtime shape is identical, so bridge the two here.
				const uploaded = await uploadImageLocally(
					generateUploadUrl,
					finalizeUpload as unknown as Parameters<
						typeof uploadImageLocally
					>[1],
					file,
				);
				return {
					src: uploaded.src,
					meta: { fileId: uploaded.fileId },
				};
			},
		}),
		[finalizeUpload, generateUploadUrl],
	);
}
