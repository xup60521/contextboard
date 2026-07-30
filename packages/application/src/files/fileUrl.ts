const FILE_SRC_PREFIX = "contextboard-file:";

export function fileSrc(fileId: string): string {
	return `${FILE_SRC_PREFIX}${encodeURIComponent(fileId)}`;
}

export function parseFileSrc(src: unknown): string | null {
	if (typeof src !== "string" || !src.startsWith(FILE_SRC_PREFIX)) return null;
	const encoded = src.slice(FILE_SRC_PREFIX.length);
	if (!encoded) return null;
	try {
		const fileId = decodeURIComponent(encoded);
		return fileId ? fileId : null;
	} catch {
		return null;
	}
}

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (!value || typeof value !== "object") return value;

	const input = value as Record<string, unknown>;
	const output = Object.fromEntries(
		Object.entries(input).map(([key, child]) => [key, normalize(child)]),
	);
	const attrs =
		output.attrs && typeof output.attrs === "object"
			? (output.attrs as Record<string, unknown>)
			: null;
	const props =
		output.props && typeof output.props === "object"
			? (output.props as Record<string, unknown>)
			: null;
	const meta =
		output.meta && typeof output.meta === "object"
			? (output.meta as Record<string, unknown>)
			: null;
	const source = attrs ?? props;
	if (!source) return output;

	const sourceMeta =
		source.meta && typeof source.meta === "object"
			? (source.meta as Record<string, unknown>)
			: null;
	const fileId =
		typeof source.fileId === "string"
			? source.fileId
			: typeof sourceMeta?.fileId === "string"
				? sourceMeta.fileId
				: typeof meta?.fileId === "string"
					? meta.fileId
					: parseFileSrc(source.src);
	if (
		fileId &&
		typeof source.src === "string" &&
		source.src.startsWith("blob:")
	) {
		source.src = fileSrc(fileId);
	}
	return output;
}

export function normalizeImageSources<T>(content: T): T {
	return normalize(content) as T;
}
