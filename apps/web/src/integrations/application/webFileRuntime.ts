import type { FileRuntime } from "@contextboard/application";
import type { ContextboardDatabase } from "@contextboard/local-db";
import { localMutation } from "../local/operations";

export function createWebFileRuntime(
	database: ContextboardDatabase,
	deviceId: string,
): FileRuntime {
	return {
		async upload(file) {
			const result = (await localMutation(
				database,
				deviceId,
				"files.finalizeUpload",
				{ storageId: "local", file },
			)) as { fileId: string };
			return {
				fileId: result.fileId,
				name: file.name,
				contentType: file.type || "application/octet-stream",
				size: file.size,
			};
		},
		async read(fileId) {
			const row = await database.files.get(fileId);
			return row?.blob ?? null;
		},
		async resolveUrl(fileId) {
			const row = await database.files.get(fileId);
			return row?.blob ? URL.createObjectURL(row.blob) : null;
		},
		releaseUrl(url) {
			if (url.startsWith("blob:")) URL.revokeObjectURL(url);
		},
	};
}
