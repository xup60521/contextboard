export const CARD_MIN_WIDTH = 200;
export const CARD_TILE_HEIGHT = 170;
export const CARD_GRID_GAP = 12;

export type CardGridMetrics = {
	width: number;
	columns: number;
	columnWidth: number;
	rowStride: number;
};

export type CardGridBox = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

export function getCardGridMetrics(width: number): CardGridMetrics {
	const safeWidth = Math.max(0, width);
	const columns = Math.max(
		1,
		Math.floor((safeWidth + CARD_GRID_GAP) / (CARD_MIN_WIDTH + CARD_GRID_GAP)),
	);
	const columnWidth = (safeWidth - (columns - 1) * CARD_GRID_GAP) / columns;

	return {
		width: safeWidth,
		columns,
		columnWidth,
		rowStride: CARD_TILE_HEIGHT + CARD_GRID_GAP,
	};
}

export function getCardBox(
	index: number,
	metrics: CardGridMetrics,
	offset: { left: number; top: number } = { left: 0, top: 0 },
): CardGridBox {
	const column = index % metrics.columns;
	const row = Math.floor(index / metrics.columns);
	const left = offset.left + column * (metrics.columnWidth + CARD_GRID_GAP);
	const top = offset.top + row * metrics.rowStride;

	return {
		left,
		right: left + metrics.columnWidth,
		top,
		bottom: top + CARD_TILE_HEIGHT,
	};
}

function boxesIntersect(a: CardGridBox, b: CardGridBox) {
	return (
		a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
	);
}

export function hitTestCardIds<CardId extends string>(
	cardIds: CardId[],
	selection: CardGridBox,
	metrics: CardGridMetrics,
	offset?: { left: number; top: number },
) {
	return cardIds.filter((_, index) =>
		boxesIntersect(getCardBox(index, metrics, offset), selection),
	);
}
