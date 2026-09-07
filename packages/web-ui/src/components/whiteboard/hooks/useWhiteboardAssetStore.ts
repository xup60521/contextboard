import {
	parseFileSrc,
	useApplicationRuntime,
} from "@contextboard/application";
import { useEffect, useMemo } from "react";
import type { TLAssetStore } from "tldraw";
import { useImageUpload } from "../../editor/useImageUpload";

export function useWhiteboardAssetStore(): TLAssetStore {
	const { files } = useApplicationRuntime();
	const uploadImage = useImageUpload();
	const state = useMemo(() => {
		const urls = new Set<string>();
		const resolved = new Map<string, Promise<string | null>>();
		const store: TLAssetStore = {
			async upload(_asset, file) {
				const uploaded = await uploadImage(file);
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
	}, [files, uploadImage]);
	useEffect(
		() => () => {
			if (!files) return;
			for (const url of state.urls) files.releaseUrl(url);
		},
		[files, state],
	);
	return state.store;
}
