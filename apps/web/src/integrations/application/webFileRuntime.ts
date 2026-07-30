import type { FileRuntime } from "@contextboard/application";
import type { IndexedDbWorkspaceRepository } from "@contextboard/storage-indexeddb";

async function sha256(blob: Blob) {
	const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function createWebFileRuntime(
	repository: IndexedDbWorkspaceRepository,
	deviceId: string,
): FileRuntime {
	return {
		async upload(file) {
			const fileId = await sha256(file);
			const contentType = file.type || "application/octet-stream";
			const now = Date.now();
			await repository.execute({
				type: "files.upsert",
				input: {
					writes: [
						{
							entity: "file",
							operation: "upsert",
							id: fileId,
							value: {
								id: fileId,
								createdAt: now,
								updatedAt: now,
								updatedByDeviceId: deviceId,
								deletedAt: null,
								sha256: fileId,
								hash: fileId,
								contentType,
								size: file.size,
								refCount: 0,
								status: "active",
								pendingDeleteAt: null,
							},
						},
					],
				},
			});
			await repository.storeRemoteBlob(
				{ hash: fileId, contentType, size: file.size },
				file,
			);
			return {
				fileId,
				name: file.name,
				contentType: file.type || "application/octet-stream",
				size: file.size,
			};
		},
		async read(fileId) {
			return (await repository.getLocalBlob(fileId))?.blob ?? null;
		},
		async resolveUrl(fileId) {
			const blob = (await repository.getLocalBlob(fileId))?.blob;
			return blob ? URL.createObjectURL(blob) : null;
		},
		releaseUrl(url) {
			if (url.startsWith("blob:")) URL.revokeObjectURL(url);
		},
	};
}
