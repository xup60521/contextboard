import { useApplicationRuntime } from "@contextboard/application";
import type { JSONContent } from "@tiptap/core";
import { useEffect, useState } from "react";

type ImageAttrs = Record<string, unknown> & { fileId?: string; src?: string };

async function resolveNodeImages(
	node: JSONContent,
	resolveUrl: (fileId: string) => Promise<string | null>,
	urls: string[],
): Promise<JSONContent> {
	const attrs = node.attrs as ImageAttrs | undefined;
	let nextAttrs = attrs;
	if (node.type === "image" && attrs?.fileId) {
		const url = await resolveUrl(attrs.fileId);
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
	const [resolved, setResolved] = useState(content);

	useEffect(() => {
		let active = true;
		const urls: string[] = [];
		setResolved(content);
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
