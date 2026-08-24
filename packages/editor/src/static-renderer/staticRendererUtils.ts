export function toDataAttribute(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	if (value.length === 0) return undefined;
	return value;
}
