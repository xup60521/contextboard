/** An axis-aligned box on the canvas, in board coordinates. */
export type Frame = { x: number; y: number; w: number; h: number };

/**
 * Breathing room kept between an auto-placed card and its neighbours, so the
 * result reads as a laid-out board rather than cards touching edge to edge.
 */
const GAP = 48;

/**
 * Cards wrap onto a new row after this many columns, so a board an agent fills
 * grows into a readable block instead of one endless horizontal strip.
 */
const MAX_COLUMNS = 4;

/** How far past the occupied bounds the grid scan is allowed to wander. */
const SCAN_MARGIN_ROWS = 2;

function overlaps(a: Frame, b: Frame) {
	// `a` is pre-inflated by the gap, so touching counts as overlapping.
	return (
		a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
	);
}

/**
 * Picks a spot for a new card that does not collide with what is already on the
 * board. Callers that know where the card belongs pass explicit coordinates
 * instead; this is the fallback for headless callers (the agent bridge, the card
 * library) that would otherwise stack every card on the origin.
 *
 * Deliberately dumb: a row-major scan of a grid anchored on the occupied
 * bounding box. It knows nothing about relations, reading order or the user's
 * viewport — it only guarantees the card lands somewhere free and near the rest
 * of the board.
 *
 * Rotation is ignored; every item is treated as its axis-aligned frame, which is
 * close enough for gap-finding.
 */
export function findFreeFrame(
	occupied: readonly Frame[],
	size: { w: number; h: number },
): Frame {
	if (occupied.length === 0) return { x: 0, y: 0, w: size.w, h: size.h };

	const bounds = {
		minX: Math.min(...occupied.map((frame) => frame.x)),
		minY: Math.min(...occupied.map((frame) => frame.y)),
		maxX: Math.max(...occupied.map((frame) => frame.x + frame.w)),
		maxY: Math.max(...occupied.map((frame) => frame.y + frame.h)),
	};

	const stepX = size.w + GAP;
	const stepY = size.h + GAP;
	const rows =
		Math.ceil((bounds.maxY - bounds.minY) / stepY) + SCAN_MARGIN_ROWS;

	// Row-major, so the card lands in reading order: the leftmost gap on the
	// topmost row that has one.
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < MAX_COLUMNS; column += 1) {
			const candidate = {
				x: bounds.minX + column * stepX,
				y: bounds.minY + row * stepY,
				w: size.w,
				h: size.h,
			};
			const inflated = {
				x: candidate.x - GAP,
				y: candidate.y - GAP,
				w: candidate.w + GAP * 2,
				h: candidate.h + GAP * 2,
			};
			if (!occupied.some((frame) => overlaps(inflated, frame)))
				return candidate;
		}
	}

	// Nothing fit inside the scanned region. Below everything is free by
	// construction, so placement never fails.
	return { x: bounds.minX, y: bounds.maxY + GAP, w: size.w, h: size.h };
}
