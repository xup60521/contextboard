import { isActiveRow } from "../../repository/entities";

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
			isActiveRow(item)
		)
			cardCount++;
	}
	for (const board of whiteboards) {
		if (board.parentWhiteboardId === whiteboardId && isActiveRow(board))
			childWhiteboardCount++;
	}
	return { cardCount, childWhiteboardCount };
}
