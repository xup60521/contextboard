import {
	parseFileSrc,
	useApplicationRuntime,
} from "@contextboard/application";
import { useEffect, useMemo } from "react";
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
	const { files } = useApplicationRuntime();
	const state = useMemo(() => {
		const urls = new Set<string>();
		const resolved = new Map<string, Promise<string | null>>();
		const store: TLAssetStore = {
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
			async resolve(asset) {
				const meta = asset.meta as { fileId?: unknown } | undefined;
				const props = asset.props as { src?: unknown };
				const fileId =
					typeof meta?.fileId === "string"
						? meta.fileId
						: parseFileSrc(props.src);
				if (!fileId || !files) return null;
				let pending = resolved.get(fileId);
				if (!pending) {
					pending = files.resolveUrl(fileId).then((url) => {
						if (url) urls.add(url);
						else resolved.delete(fileId);
						return url;
					});
					resolved.set(fileId, pending);
				}
				return pending;
			},
		};
		return { store, urls };
	}, [files, finalizeUpload, generateUploadUrl]);
	useEffect(
		() => () => {
			if (!files) return;
			for (const url of state.urls) files.releaseUrl(url);
		},
		[files, state],
	);
	return state.store;
}
