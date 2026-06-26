export async function uploadImageToConvex(
	generateUploadUrl: () => Promise<string>,
	getImageUrl: (args: { storageId: string }) => Promise<string | null>,
	file: File,
): Promise<string> {
	const uploadUrl = await generateUploadUrl();

	const response = await fetch(uploadUrl, {
		method: "POST",
		headers: { "Content-Type": file.type },
		body: file,
	});
	const { storageId } = (await response.json()) as { storageId: string };

	const url = await getImageUrl({ storageId });

	if (!url) {
		throw new Error("Failed to get image URL");
	}

	return url;
}
