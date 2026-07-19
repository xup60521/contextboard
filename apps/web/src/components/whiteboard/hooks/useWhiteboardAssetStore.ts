import { useMemo } from "react";
import type { TLAssetStore } from "tldraw";
import type { Id } from "#/integrations/local/types";
import { uploadImageLocally } from "../../editor/ImageUpload";

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
				const uploaded = await uploadImageLocally(
					generateUploadUrl,
					finalizeUpload,
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
