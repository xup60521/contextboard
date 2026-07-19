export function toSafeHref(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;

	if (
		value.startsWith("/") ||
		value.startsWith("#") ||
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.startsWith("mailto:")
	) {
		return value;
	}

	return undefined;
}

export function toDataAttribute(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	if (value.length === 0) return undefined;
	return value;
}

export function isExternalHref(href: string | undefined): boolean {
	return Boolean(
		href?.startsWith("http://") ||
			href?.startsWith("https://") ||
			href?.startsWith("mailto:"),
	);
}
