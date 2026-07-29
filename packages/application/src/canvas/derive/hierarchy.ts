export function deriveChildHierarchy(
	parent: {
		id: string;
		ancestorIds: string[];
		depth: number;
		pathKey: string;
	} | null,
	activeChildCount: number,
	now: number,
) {
	const sortKey = `${String(activeChildCount).padStart(10, "0")}-${now.toString(36)}`;
	return {
		parentWhiteboardId: parent?.id ?? null,
		ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
		depth: (parent?.depth ?? -1) + 1,
		sortKey,
		pathKey: parent ? `${parent.pathKey}/${sortKey}` : sortKey,
	};
}
