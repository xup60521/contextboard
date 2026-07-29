import type { FileRuntime } from "@contextboard/application";
import type { DesktopWorkspaceRepository } from "@contextboard/storage-desktop";

async function sha256(blob: Blob) {
	const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function createDesktopFileRuntime(
	repository: DesktopWorkspaceRepository,
	deviceId = "desktop",
): FileRuntime {
	return {
		async upload(file) {
			const fileId = await sha256(file);
			const contentType = file.type || "application/octet-stream";
			await repository.storeRemoteBlob(
				{ hash: fileId, contentType, size: file.size },
				file,
			);
			const now = Date.now();
			await repository.execute({
				type: "files.upsert",
				input: {
					value: {
						id: fileId,
						createdAt: now,
						updatedAt: now,
						updatedByDeviceId: deviceId,
						deletedAt: null,
						sha256: fileId,
						contentType,
						size: file.size,
						refCount: 0,
						status: "active",
						pendingDeleteAt: null,
					},
				},
			});
			return { fileId, name: file.name, contentType, size: file.size };
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
