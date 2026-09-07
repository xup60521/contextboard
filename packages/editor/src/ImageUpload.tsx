import type { Id } from "./platform/types";

export type UploadedImage = {
	fileId: Id<"files">;
	src: string;
	storageId: Id<"_storage">;
};
