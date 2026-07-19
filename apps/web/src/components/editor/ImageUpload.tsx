import type { Id } from "#/integrations/local/types";

export type UploadedImage = {
	fileId: Id<"files">;
	src: string;
	storageId: Id<"_storage">;
};

type FinalizedUpload = {
	fileId: Id<"files">;
	storageId: Id<"_storage">;
	url: string;
};

export async function uploadImageLocally(
	generateUploadUrl: () => Promise<string>,
	finalizeUpload: (args: { storageId: Id<"_storage">; file?: File }) => Promise<FinalizedUpload>,
	file: File,
): Promise<UploadedImage> {
	const uploadUrl = await generateUploadUrl();
	if (uploadUrl === "contextboard-local:") {
		const uploaded = await finalizeUpload({ storageId: "local" as Id<"_storage">, file });
		return { fileId: uploaded.fileId, src: uploaded.url, storageId: uploaded.storageId };
	}

	const response = await fetch(uploadUrl, {
		method: "POST",
		headers: { "Content-Type": file.type },
		body: file,
	});
	const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
	const uploaded = await finalizeUpload({ storageId });
	return {
		fileId: uploaded.fileId,
		src: uploaded.url,
		storageId: uploaded.storageId,
	};
}
