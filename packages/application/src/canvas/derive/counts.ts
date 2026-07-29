export type CountableBoardItem = {
	whiteboardId: string | null;
	kind: "card" | "subwhiteboard";
	archivedAt?: number | null;
	deletedAt: number | null;
};

export type CountableWhiteboard = {
	id: string;
	parentWhiteboardId: string | null;
	archivedAt?: number | null;
	deletedAt: number | null;
};

const active = (row: { archivedAt?: number | null; deletedAt: number | null }) =>
	row.deletedAt === null &&
	(row.archivedAt === undefined || row.archivedAt === null);

export function deriveWhiteboardCounts(
	whiteboardId: string,
	items: readonly CountableBoardItem[],
	whiteboards: readonly CountableWhiteboard[],
) {
	let cardCount = 0;
	let childWhiteboardCount = 0;
	for (const item of items) {
		if (
			item.whiteboardId === whiteboardId &&
			item.kind === "card" &&
			active(item)
		)
			cardCount++;
	}
	for (const board of whiteboards) {
		if (board.parentWhiteboardId === whiteboardId && active(board))
			childWhiteboardCount++;
	}
	return { cardCount, childWhiteboardCount };
}
