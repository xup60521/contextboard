import {
	parseFileSrc,
	useApplicationRuntime,
} from "@contextboard/application";
import type { JSONContent } from "@tiptap/core";
import { useEffect, useState } from "react";

type ImageAttrs = Record<string, unknown> & { fileId?: string; src?: string };

function hideDurableSources(node: JSONContent): JSONContent {
	const attrs = node.attrs as ImageAttrs | undefined;
	const content = node.content?.map(hideDurableSources);
	return {
		...node,
		...(attrs && parseFileSrc(attrs.src)
			? { attrs: { ...attrs, src: "" } }
			: {}),
		...(content ? { content } : {}),
	};
}

async function resolveNodeImages(
	node: JSONContent,
	resolveUrl: (fileId: string) => Promise<string | null>,
	urls: string[],
): Promise<JSONContent> {
	const attrs = node.attrs as ImageAttrs | undefined;
	let nextAttrs = attrs;
	const fileId = attrs?.fileId ?? parseFileSrc(attrs?.src);
	if (node.type === "image" && fileId) {
		const url = await resolveUrl(fileId);
		if (url) {
			urls.push(url);
			nextAttrs = { ...attrs, src: url };
		}
	}
	const content = node.content
		? await Promise.all(
				node.content.map((child) => resolveNodeImages(child, resolveUrl, urls)),
			)
		: undefined;
	return {
		...node,
		...(nextAttrs ? { attrs: nextAttrs } : {}),
		...(content ? { content } : {}),
	};
}

/**
 * Rehydrates image nodes through the platform blob runtime. Persisted object
 * URLs are ignored because their lifetime ends when the app is closed.
 */
export function useResolvedCardContent(content: JSONContent): JSONContent {
	const runtime = useApplicationRuntime();
	const [resolved, setResolved] = useState(() => hideDurableSources(content));

	useEffect(() => {
		let active = true;
		const urls: string[] = [];
		setResolved(hideDurableSources(content));
		if (runtime.files) {
			void resolveNodeImages(content, runtime.files.resolveUrl, urls).then((next) => {
				if (active) setResolved(next);
				else for (const url of urls) runtime.files?.releaseUrl(url);
			});
		}
		return () => {
			active = false;
			for (const url of urls) runtime.files?.releaseUrl(url);
		};
	}, [content, runtime.files]);

	return resolved;
}
