/**
 * Href allowlist shared by the editable editor and the static renderer, so a
 * link that survives one surface behaves identically on the other.
 */

const EXTERNAL_PREFIXES = ["http://", "https://", "mailto:"] as const;
const INTERNAL_PREFIXES = ["/", "#"] as const;

/** Returns the href when it is a scheme we are willing to render or open. */
export function toSafeHref(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;

	const allowed = [...EXTERNAL_PREFIXES, ...INTERNAL_PREFIXES].some((prefix) =>
		value.startsWith(prefix),
	);

	return allowed ? value : undefined;
}

/** Whether the href leaves the app (and therefore needs the platform opener). */
export function isExternalHref(href: string | undefined): boolean {
	return EXTERNAL_PREFIXES.some((prefix) => href?.startsWith(prefix));
}
