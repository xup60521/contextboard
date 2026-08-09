export function collectReferenceIds(
	value: unknown,
	field: "fileId" | "cardId" | "whiteboardRefId",
	result = new Set<string>(),
): Set<string> {
	if (Array.isArray(value)) {
		for (const child of value) collectReferenceIds(child, field, result);
		return result;
	}
	if (!value || typeof value !== "object") return result;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key === field && typeof child === "string" && child) result.add(child);
		else collectReferenceIds(child, field, result);
	}
	return result;
}
