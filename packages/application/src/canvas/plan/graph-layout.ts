/**
 * Lays out cards whose arrows form a graph rather than a tree.
 *
 * The layered packer next door assumes every card has one parent. Boards built
 * by research tend not to: they come out as one big component with cross-links
 * and dozens of entry points, and forcing that into layers produces a ribbon
 * thousands of pixels tall with arrows running the length of it.
 *
 * Three stages, and each fixes what the one before it cannot see:
 *  - stress majorization decides where cards belong *relative to each other*,
 *    by pulling every pair toward a distance proportional to their hop count.
 *    That is what keeps related cards together and arrows short.
 *  - a grid snap then forces those positions onto shared columns and rows. On
 *    its own, stage one produces a cloud: structurally correct, but nothing
 *    lines up, and a board of 200 cards at 200 slightly different offsets reads
 *    as noise. The grid is what makes it look arranged.
 *  - a refinement pass finally shuffles cards between cells to pull the arrows
 *    apart. Neither stage above looks at arrow geometry at all, and distance
 *    error is not the same thing as legibility: a board can be perfectly
 *    aligned and perfectly compact and still be a ball of wool.
 *
 * Deterministic throughout — seeded from the cards' current positions, no
 * randomness — so the same board always arranges the same way.
 */

import type { ArrangeEdge, ArrangeNode } from "./arrange-relations";
import type { Frame } from "./place-card-frame";

const GAP_MAIN = 120;
const GAP_CROSS = 48;
const GAP_COMPONENT = 96;
const MAX_DENSE_NODES = 600;

/**
 * Gaps between grid columns and rows.
 *
 * Much wider than the tree layout's, because the board is infinite and these
 * gaps are the only place a graph's arrows have to run. Tightening them does
 * not make the board easier to read: it just routes more arrows straight
 * through the middle of other cards.
 */
const GRAPH_GAP_COLUMN = 360;
const GRAPH_GAP_ROW = 280;

/** Rings of the spiral search before a card gives up and takes its ideal cell. */
const MAX_LATTICE_RINGS = 1024;
/** Cells one obstacle may block. Stops a stray huge frame from eating the grid. */
const MAX_OBSTACLE_CELLS = 4096;

/** How far a card may be moved or swapped by the refinement pass, in cells. */
const REFINE_RADIUS = 2;
/** Refinement stops early once a sweep changes nothing; this is the ceiling. */
const MAX_REFINE_SWEEPS = 8;
/** Above this the pass is skipped: its cost grows with nodes times edges. */
const MAX_REFINE_NODES = 400;

/** One crossing between two arrows. The unit the other weights are quoted in. */
const COST_CROSSING = 1;
/**
 * An arrow passing through an unrelated card. Slightly cheaper than a crossing:
 * ugly, but a reader can still follow the line.
 */
const COST_THROUGH_CARD = 0.6;
/**
 * Per pixel of arrow. Deliberately tiny — just enough to break ties toward the
 * tighter of two equally legible arrangements, never enough to buy a crossing.
 */
const COST_PER_PIXEL = 0.00004;
/**
 * A busy card's spoke that is shorter than the room that card needs, scaled by
 * how far short it falls.
 *
 * Stretching the graph metric alone does not survive: the grid snap quantises
 * the extra room away, and this very pass — paid by `COST_PER_PIXEL` to shorten
 * arrows — then pulls the neighbours back in. Measured on the research board
 * that left the busiest cards with the *tightest* spokes of anything, which is
 * backwards. Pricing cramped spokes here puts the requirement in front of the
 * optimizer that would otherwise spend it, without walling off grid cells and
 * starving its search.
 */
const COST_CRAMPED_SPOKE = 3;
const MAX_PIVOTS = 100;
const INITIAL_STRESS_ITERATIONS = 90;
const OUTER_ROUNDS = 6;
const ROUND_STRESS_ITERATIONS = 12;
const STRESS_EPSILON = 1e-4;

type StressPair = { a: number; b: number; ideal: number; weight: number };
type Point = { x: number; y: number };

function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

type Lattice = { colPitch: number; rowPitch: number };

/**
 * The grid every card ends up on.
 *
 * One column is the widest card plus the arrowhead gap, so no card ever needs
 * more than a single column and neighbouring columns keep a channel wide enough
 * to draw an arrow into. Rows follow the *median* height rather than the tallest
 * card: most cards then occupy exactly one row, and the few tall ones span two
 * or three without forcing that slack on everyone else.
 */
function latticeFor(boxes: readonly { w: number; h: number }[]): Lattice {
	let widest = 0;
	for (const box of boxes) widest = Math.max(widest, box.w);
	return {
		colPitch: widest + GRAPH_GAP_COLUMN,
		rowPitch: median(boxes.map((box) => box.h)) + GRAPH_GAP_ROW,
	};
}

function adjacencyFor(
	nodes: readonly ArrangeNode[],
	edges: readonly ArrangeEdge[],
): number[][] {
	const index = new Map(nodes.map((node, position) => [node.id, position]));
	const adjacency = nodes.map(() => [] as number[]);
	const seen = new Set<string>();
	for (const edge of edges) {
		const a = index.get(edge.source);
		const b = index.get(edge.target);
		if (a === undefined || b === undefined || a === b) continue;
		const low = Math.min(a, b);
		const high = Math.max(a, b);
		const key = `${low}:${high}`;
		if (seen.has(key)) continue;
		seen.add(key);
		adjacency[a].push(b);
		adjacency[b].push(a);
	}
	for (const neighbours of adjacency) neighbours.sort((a, b) => a - b);
	return adjacency;
}

/**
 * How much further apart a busy card's neighbours are asked to sit.
 *
 * A card with nine arrows on it has to fit nine lines around its edge. At the
 * spacing everything else uses, those neighbours are packed shoulder to
 * shoulder and the arrows leave in a fan so tight it reads as a smudge — and
 * every one of them has to cross the ring of cards sitting around the hub.
 *
 * The room a card needs follows from that directly. Lay its neighbours on a
 * circle around it and the arc between two of them is `2πr / degree`, so
 * keeping a constant gap between adjacent spokes means the radius has to grow
 * *in proportion to the degree*. Hence a ratio and not a threshold: every
 * well-connected card gets a berth sized to its own traffic, rather than only
 * the ones that beat some cut-off. `HUB_COMFORT_DEGREE` is the degree a card
 * can carry at the board's ordinary spacing.
 */
const HUB_COMFORT_DEGREE = 3;
/** Ceiling on the stretch a single arrow is held to. */
const HUB_MAX_STRETCH = 3;
/**
 * A much tighter ceiling for the *graph metric*, which is where the same stretch
 * does damage at a distance. Path lengths there are sums, so every hub a route
 * passes through compounds, and the whole board inflates rather than just the
 * neighbourhood that needed room. Measured on the research board, sharing one
 * ceiling dropped card density from 23% to 12% and hollowed the corners out.
 */
const HUB_METRIC_MAX_STRETCH = 1.5;
/**
 * The share of a hub's berth that a spoke claims when its far end is a leaf.
 *
 * A hub's need is *angular*: room for each arrow to leave at its own bearing.
 * How much radial distance that buys back depends on what is at the other end.
 * A leaf occupies one card's worth of arc and can sit close; a neighbour that
 * is itself well-connected arrives with its own fan and needs the full berth.
 * Applying the hub's requirement to both ends alike — which is what taking the
 * larger of the two degrees does — pushes every leaf out to the distance the
 * heaviest branch needed, and hollows the middle of the board out.
 */
const HUB_LEAF_WEIGHT = 0.3;

/**
 * How far apart to hold the two ends of one arrow, as a multiple of a cell.
 *
 * Driven by the busier end, discounted by how little the quieter end brings
 * with it.
 */
function hubStretch(first: number, second: number, ceiling: number): number {
	const busiest = Math.max(first, second);
	const quietest = Math.min(first, second);
	const bulk =
		HUB_LEAF_WEIGHT +
		(1 - HUB_LEAF_WEIGHT) * Math.min(1, quietest / HUB_COMFORT_DEGREE);
	return Math.min(ceiling, Math.max(1, (busiest * bulk) / HUB_COMFORT_DEGREE));
}

/** Per-edge distance in the layout's metric, stretched around busy cards. */
function edgeCostsFor(adjacency: readonly number[][]): number[][] {
	return adjacency.map((neighbours) =>
		neighbours.map((next) =>
			hubStretch(
				neighbours.length,
				adjacency[next].length,
				HUB_METRIC_MAX_STRETCH,
			),
		),
	);
}

/**
 * Shortest path from one card to every other, in the stretched metric.
 *
 * Dijkstra rather than a breadth-first walk, because hub edges are longer than
 * one hop; with the stretch disabled the two agree exactly.
 */
function distancesFrom(
	start: number,
	adjacency: readonly number[][],
	edgeCosts: readonly number[][],
): Float64Array {
	const distances = new Float64Array(adjacency.length).fill(-1);
	const settled = new Uint8Array(adjacency.length);
	// Binary heap of (distance, node), smallest first.
	const heapDistance: number[] = [0];
	const heapNode: number[] = [start];
	distances[start] = 0;
	const swap = (a: number, b: number) => {
		const distance = heapDistance[a];
		const node = heapNode[a];
		heapDistance[a] = heapDistance[b];
		heapNode[a] = heapNode[b];
		heapDistance[b] = distance;
		heapNode[b] = node;
	};
	const push = (distance: number, node: number) => {
		heapDistance.push(distance);
		heapNode.push(node);
		let child = heapDistance.length - 1;
		while (child > 0) {
			const parent = (child - 1) >> 1;
			if (heapDistance[parent] <= heapDistance[child]) break;
			swap(parent, child);
			child = parent;
		}
	};
	const pop = (): number => {
		const node = heapNode[0];
		const lastDistance = heapDistance.pop() as number;
		const lastNode = heapNode.pop() as number;
		if (heapDistance.length > 0) {
			heapDistance[0] = lastDistance;
			heapNode[0] = lastNode;
			let parent = 0;
			for (;;) {
				const leftChild = parent * 2 + 1;
				const rightChild = leftChild + 1;
				let smallest = parent;
				if (
					leftChild < heapDistance.length &&
					heapDistance[leftChild] < heapDistance[smallest]
				) {
					smallest = leftChild;
				}
				if (
					rightChild < heapDistance.length &&
					heapDistance[rightChild] < heapDistance[smallest]
				) {
					smallest = rightChild;
				}
				if (smallest === parent) break;
				swap(parent, smallest);
				parent = smallest;
			}
		}
		return node;
	};

	while (heapDistance.length > 0) {
		const current = pop();
		if (settled[current]) continue;
		settled[current] = 1;
		const neighbours = adjacency[current];
		for (let index = 0; index < neighbours.length; index += 1) {
			const next = neighbours[index];
			const candidate = distances[current] + edgeCosts[current][index];
			if (distances[next] !== -1 && distances[next] <= candidate) continue;
			distances[next] = candidate;
			push(candidate, next);
		}
	}
	return distances;
}

function buildStressPairs(
	nodes: readonly ArrangeNode[],
	adjacency: readonly number[][],
	idealLength: number,
): StressPair[] {
	const pairs: StressPair[] = [];
	const edgeCosts = edgeCostsFor(adjacency);
	if (nodes.length <= MAX_DENSE_NODES) {
		for (let a = 0; a < nodes.length; a += 1) {
			const distances = distancesFrom(a, adjacency, edgeCosts);
			for (let b = a + 1; b < nodes.length; b += 1) {
				const hops = distances[b];
				if (hops <= 0) continue;
				const ideal = hops * idealLength;
				pairs.push({ a, b, ideal, weight: 1 / (ideal * ideal) });
			}
		}
		return pairs;
	}

	// Pivot MDS keeps large components bounded: every node is constrained to a
	// deterministic sample of at most 100 BFS pivots, plus every graph edge.
	const pairKeys = new Set<string>();
	const pivotCount = Math.min(MAX_PIVOTS, nodes.length);
	for (let pivot = 0; pivot < pivotCount; pivot += 1) {
		const a = Math.floor((pivot * nodes.length) / pivotCount);
		const distances = distancesFrom(a, adjacency, edgeCosts);
		for (let b = 0; b < nodes.length; b += 1) {
			if (a === b || distances[b] <= 0) continue;
			const low = Math.min(a, b);
			const high = Math.max(a, b);
			const key = `${low}:${high}`;
			if (pairKeys.has(key)) continue;
			pairKeys.add(key);
			const ideal = distances[b] * idealLength;
			pairs.push({ a: low, b: high, ideal, weight: 1 / (ideal * ideal) });
		}
	}
	for (let a = 0; a < adjacency.length; a += 1) {
		for (const b of adjacency[a]) {
			if (b <= a) continue;
			const key = `${a}:${b}`;
			if (pairKeys.has(key)) continue;
			pairs.push({
				a,
				b,
				ideal: idealLength,
				weight: 1 / (idealLength * idealLength),
			});
		}
	}
	return pairs;
}

function normaliseSeed(points: Point[], idealLength: number): void {
	if (points.length < 2) return;
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let centreX = 0;
	let centreY = 0;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
		centreX += point.x;
		centreY += point.y;
	}
	centreX /= points.length;
	centreY /= points.length;
	const width = maxX - minX;
	const height = maxY - minY;
	const ratio = width / Math.max(height, 1);
	if (width < idealLength * 0.1 && height < idealLength * 0.1) {
		const columns = Math.ceil(Math.sqrt(points.length * (16 / 9)));
		for (let index = 0; index < points.length; index += 1) {
			points[index].x = centreX + (index % columns) * idealLength;
			points[index].y = centreY + Math.floor(index / columns) * idealLength;
		}
		return;
	}
	if (ratio >= 0.4 && ratio <= 2.5) return;
	const targetRatio = 16 / 9;
	const scaleX = Math.sqrt(targetRatio / Math.max(ratio, 1e-6));
	const scaleY = 1 / scaleX;
	for (const point of points) {
		point.x = centreX + (point.x - centreX) * scaleX;
		point.y = centreY + (point.y - centreY) * scaleY;
	}
}

function stress(
	points: Point[],
	pairs: readonly StressPair[],
	iterations: number,
	allowEarlyExit: boolean,
): void {
	if (points.length < 2 || pairs.length === 0) return;
	let previousStress = Number.POSITIVE_INFINITY;
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const sumX = new Float64Array(points.length);
		const sumY = new Float64Array(points.length);
		const weights = new Float64Array(points.length);
		let currentStress = 0;
		for (const pair of pairs) {
			const first = points[pair.a];
			const second = points[pair.b];
			const dx = first.x - second.x;
			const dy = first.y - second.y;
			const distance = Math.max(Math.hypot(dx, dy), 1e-6);
			const scale = pair.ideal / distance;
			const projectedAX = second.x + dx * scale;
			const projectedAY = second.y + dy * scale;
			const projectedBX = first.x - dx * scale;
			const projectedBY = first.y - dy * scale;
			sumX[pair.a] += pair.weight * projectedAX;
			sumY[pair.a] += pair.weight * projectedAY;
			weights[pair.a] += pair.weight;
			sumX[pair.b] += pair.weight * projectedBX;
			sumY[pair.b] += pair.weight * projectedBY;
			weights[pair.b] += pair.weight;
			const error = distance - pair.ideal;
			currentStress += pair.weight * error * error;
		}

		let beforeX = 0;
		let beforeY = 0;
		let afterX = 0;
		let afterY = 0;
		for (let index = 0; index < points.length; index += 1) {
			beforeX += points[index].x;
			beforeY += points[index].y;
			if (weights[index] > 0) {
				points[index].x = sumX[index] / weights[index];
				points[index].y = sumY[index] / weights[index];
			}
			afterX += points[index].x;
			afterY += points[index].y;
		}
		const shiftX = (beforeX - afterX) / points.length;
		const shiftY = (beforeY - afterY) / points.length;
		for (const point of points) {
			point.x += shiftX;
			point.y += shiftY;
		}

		if (
			allowEarlyExit &&
			Number.isFinite(previousStress) &&
			Math.abs(previousStress - currentStress) /
				Math.max(previousStress, 1e-9) <
				STRESS_EPSILON
		) {
			break;
		}
		previousStress = currentStress;
	}
}

function componentBounds(
	nodes: readonly ArrangeNode[],
	points: readonly Point[],
): Frame {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < nodes.length; index += 1) {
		minX = Math.min(minX, points[index].x - nodes[index].w / 2);
		minY = Math.min(minY, points[index].y - nodes[index].h / 2);
		maxX = Math.max(maxX, points[index].x + nodes[index].w / 2);
		maxY = Math.max(maxY, points[index].y + nodes[index].h / 2);
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function layoutComponent(
	nodes: readonly ArrangeNode[],
	edges: readonly ArrangeEdge[],
	idealLength: number,
): { nodes: readonly ArrangeNode[]; points: Point[]; bounds: Frame } {
	const sortedNodes = [...nodes].sort((a, b) => compareIds(a.id, b.id));
	const adjacency = adjacencyFor(sortedNodes, edges);
	const pairs = buildStressPairs(sortedNodes, adjacency, idealLength);
	const points = sortedNodes.map((node) => ({
		x: node.x + node.w / 2,
		y: node.y + node.h / 2,
	}));
	normaliseSeed(points, idealLength);
	stress(points, pairs, INITIAL_STRESS_ITERATIONS, true);
	for (let round = 0; round < OUTER_ROUNDS; round += 1) {
		stress(points, pairs, ROUND_STRESS_ITERATIONS, false);
	}
	return {
		nodes: sortedNodes,
		points,
		bounds: componentBounds(sortedNodes, points),
	};
}

/**
 * Lays connected graph components out independently, then shelf-packs their
 * bounding boxes toward a 16:9 whole-board shape.
 */
export function arrangeGraphFrames(
	nodes: readonly ArrangeNode[],
	edges: readonly ArrangeEdge[],
	components: readonly (readonly string[])[],
): Map<string, Frame> {
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	// One ideal edge length for the whole board, sized to the grid the cards are
	// about to snap onto, so a hop in the graph is about one cell on the screen.
	const { colPitch, rowPitch } = latticeFor(nodes);
	const idealLength = (colPitch + rowPitch) / 2;
	const layouts = components.map((ids) => {
		const members = new Set(ids);
		return layoutComponent(
			ids.map((id) => nodeById.get(id) as ArrangeNode),
			edges.filter(
				(edge) => members.has(edge.source) && members.has(edge.target),
			),
			idealLength,
		);
	});
	const totalArea = layouts.reduce(
		(sum, layout) => sum + layout.bounds.w * layout.bounds.h,
		0,
	);
	const targetWidth = Math.max(
		...layouts.map((layout) => layout.bounds.w),
		Math.sqrt(totalArea * (16 / 9)),
	);
	const frames = new Map<string, Frame>();
	let cursorX = 0;
	let cursorY = 0;
	let rowHeight = 0;
	for (const layout of layouts) {
		if (cursorX > 0 && cursorX + layout.bounds.w > targetWidth) {
			cursorX = 0;
			cursorY += rowHeight + GAP_COMPONENT;
			rowHeight = 0;
		}
		const shiftX = cursorX - layout.bounds.x;
		const shiftY = cursorY - layout.bounds.y;
		for (let index = 0; index < layout.nodes.length; index += 1) {
			const node = layout.nodes[index];
			const point = layout.points[index];
			frames.set(node.id, {
				x: point.x - node.w / 2 + shiftX,
				y: point.y - node.h / 2 + shiftY,
				w: node.w,
				h: node.h,
			});
		}
		cursorX += layout.bounds.w + GAP_COMPONENT;
		rowHeight = Math.max(rowHeight, layout.bounds.h);
	}
	return frames;
}

/** Every cell a rectangle touches, as `column:row` keys. */
function cellsUnder(
	frame: Frame,
	origin: Point,
	lattice: Lattice,
	into: Set<string>,
): void {
	const left = frame.x - GAP_CROSS / 2;
	const top = frame.y - GAP_CROSS / 2;
	const firstColumn = Math.floor((left - origin.x) / lattice.colPitch);
	const lastColumn = Math.ceil(
		(left + frame.w + GAP_CROSS - origin.x) / lattice.colPitch,
	);
	const firstRow = Math.floor((top - origin.y) / lattice.rowPitch);
	const lastRow = Math.ceil(
		(top + frame.h + GAP_CROSS - origin.y) / lattice.rowPitch,
	);
	if ((lastColumn - firstColumn) * (lastRow - firstRow) > MAX_OBSTACLE_CELLS) {
		return;
	}
	for (let column = firstColumn; column < lastColumn; column += 1) {
		for (let row = firstRow; row < lastRow; row += 1) {
			into.add(`${column}:${row}`);
		}
	}
}

function sameSide(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	px: number,
	py: number,
): boolean {
	return (py - ay) * (bx - ax) > (by - ay) * (px - ax);
}

/** True when two open segments properly cross. Shared endpoints do not count. */
function segmentsCross(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	dx: number,
	dy: number,
): boolean {
	if (Math.max(ax, bx) < Math.min(cx, dx)) return false;
	if (Math.max(cx, dx) < Math.min(ax, bx)) return false;
	if (Math.max(ay, by) < Math.min(cy, dy)) return false;
	if (Math.max(cy, dy) < Math.min(ay, by)) return false;
	return (
		sameSide(ax, ay, cx, cy, dx, dy) !== sameSide(bx, by, cx, cy, dx, dy) &&
		sameSide(ax, ay, bx, by, cx, cy) !== sameSide(ax, ay, bx, by, dx, dy)
	);
}

/** True when a segment enters a card's body rather than passing it by. */
function segmentHitsRect(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	x: number,
	y: number,
	w: number,
	h: number,
): boolean {
	const right = x + w;
	const bottom = y + h;
	if (Math.max(ax, bx) < x || Math.min(ax, bx) > right) return false;
	if (Math.max(ay, by) < y || Math.min(ay, by) > bottom) return false;
	return (
		segmentsCross(ax, ay, bx, by, x, y, right, y) ||
		segmentsCross(ax, ay, bx, by, right, y, right, bottom) ||
		segmentsCross(ax, ay, bx, by, right, bottom, x, bottom) ||
		segmentsCross(ax, ay, bx, by, x, bottom, x, y)
	);
}

type Grid = {
	lattice: Lattice;
	origin: Point;
	/** Cells covered by something that will not move. */
	blocked: Set<string>;
	/** Cell to the index of the card sitting on it. */
	occupant: Map<string, number>;
	column: number[];
	row: number[];
	spanColumns: number[];
	spanRows: number[];
	widths: number[];
	heights: number[];
	/** Cached pixel geometry, kept in step with `column`/`row` by `dropOnGrid`. */
	left: number[];
	top: number[];
	centreX: number[];
	centreY: number[];
};

function cellKey(column: number, row: number): string {
	return `${column}:${row}`;
}

function liftFromGrid(grid: Grid, index: number): void {
	for (let across = 0; across < grid.spanColumns[index]; across += 1) {
		for (let down = 0; down < grid.spanRows[index]; down += 1) {
			grid.occupant.delete(
				cellKey(grid.column[index] + across, grid.row[index] + down),
			);
		}
	}
}

function dropOnGrid(
	grid: Grid,
	index: number,
	column: number,
	row: number,
): void {
	grid.column[index] = column;
	grid.row[index] = row;
	grid.left[index] = grid.origin.x + column * grid.lattice.colPitch;
	grid.top[index] = grid.origin.y + row * grid.lattice.rowPitch;
	grid.centreX[index] = grid.left[index] + grid.widths[index] / 2;
	grid.centreY[index] = grid.top[index] + grid.heights[index] / 2;
	for (let across = 0; across < grid.spanColumns[index]; across += 1) {
		for (let down = 0; down < grid.spanRows[index]; down += 1) {
			grid.occupant.set(cellKey(column + across, row + down), index);
		}
	}
}

/** Whether a card fits at a cell. Callers lift the cards being moved first. */
function fitsOnGrid(
	grid: Grid,
	index: number,
	column: number,
	row: number,
): boolean {
	for (let across = 0; across < grid.spanColumns[index]; across += 1) {
		for (let down = 0; down < grid.spanRows[index]; down += 1) {
			const key = cellKey(column + across, row + down);
			if (grid.blocked.has(key)) return false;
			if (grid.occupant.has(key)) return false;
		}
	}
	return true;
}

/**
 * Untangles the arrows by moving cards between grid cells.
 *
 * Stress majorization minimises distance error, which is not the same thing as
 * minimising crossings — it will happily hand back a layout where two clusters
 * sit on opposite sides of the board with a dozen arrows braided between them.
 * Nothing earlier in the pipeline looks at arrow geometry at all, so on a real
 * research board the snapped grid still lands around one crossing per arrow.
 *
 * So this pass optimises the thing you actually see. It walks the cards in a
 * fixed order and, for each, tries every move to a free cell and every swap
 * with an occupied one inside `REFINE_RADIUS`, keeping the single best change
 * that lowers the cost. Cost is crossings, plus arrows driven through the body
 * of an unrelated card, plus a whisper of total arrow length to settle ties.
 *
 * Only edges touching the cards being moved can change, so each candidate is
 * scored by re-costing those edges alone; the difference is an exact global
 * delta. Sweeps repeat until one changes nothing, which on a 200-card board
 * takes about five.
 */
function refineGridPlacement(
	grid: Grid,
	edgeA: readonly number[],
	edgeB: readonly number[],
): void {
	const count = grid.column.length;
	if (count > MAX_REFINE_NODES || edgeA.length === 0) return;
	const edgeCount = edgeA.length;
	const incident: number[][] = Array.from({ length: count }, () => []);
	const degree = new Int32Array(count);
	for (let edge = 0; edge < edgeCount; edge += 1) {
		incident[edgeA[edge]].push(edge);
		incident[edgeB[edge]].push(edge);
		degree[edgeA[edge]] += 1;
		degree[edgeB[edge]] += 1;
	}

	// The room each arrow needs, in pixels. See `hubStretch`.
	const shortestCell = Math.min(grid.lattice.colPitch, grid.lattice.rowPitch);
	const roomNeeded = new Float64Array(edgeCount);
	for (let edge = 0; edge < edgeCount; edge += 1) {
		roomNeeded[edge] =
			shortestCell *
			hubStretch(degree[edgeA[edge]], degree[edgeB[edge]], HUB_MAX_STRETCH);
	}

	const { widths, heights, left, top, centreX, centreY } = grid;
	/** Crossings and through-card hits found by the last `costAround` call. */
	let defects = 0;

	// Broad phase for "does this arrow pierce a card". Testing every card is
	// wasted work when a typical arrow is two cells long, and the occupancy map
	// already indexes cards by cell — so walk the cells the arrow's bounding box
	// touches and look only at what sits on them. `stamp` dedupes cards spanning
	// several cells without allocating a set per query.
	let maxSpanColumns = 1;
	let maxSpanRows = 1;
	for (let index = 0; index < count; index += 1) {
		maxSpanColumns = Math.max(maxSpanColumns, grid.spanColumns[index]);
		maxSpanRows = Math.max(maxSpanRows, grid.spanRows[index]);
	}
	const stamp = new Int32Array(count).fill(-1);
	let query = 0;
	const nearbyCards: number[] = [];
	const collectNearbyCards = (
		ax: number,
		ay: number,
		bx: number,
		by: number,
	): void => {
		nearbyCards.length = 0;
		query += 1;
		const firstColumn =
			Math.floor((Math.min(ax, bx) - grid.origin.x) / grid.lattice.colPitch) -
			maxSpanColumns +
			1;
		const lastColumn = Math.floor(
			(Math.max(ax, bx) - grid.origin.x) / grid.lattice.colPitch,
		);
		const firstRow =
			Math.floor((Math.min(ay, by) - grid.origin.y) / grid.lattice.rowPitch) -
			maxSpanRows +
			1;
		const lastRow = Math.floor(
			(Math.max(ay, by) - grid.origin.y) / grid.lattice.rowPitch,
		);
		for (let column = firstColumn; column <= lastColumn; column += 1) {
			for (let row = firstRow; row <= lastRow; row += 1) {
				const card = grid.occupant.get(cellKey(column, row));
				if (card === undefined || stamp[card] === query) continue;
				stamp[card] = query;
				nearbyCards.push(card);
			}
		}
	};

	// The same broad phase for "do these two arrows cross". Rebuilt whenever a
	// card actually moves; during a candidate evaluation only the arrows of the
	// cards being tried are out of date, and those are compared directly below.
	const edgeBuckets = new Map<string, number[]>();
	const edgeCells = (
		ax: number,
		ay: number,
		bx: number,
		by: number,
	): {
		firstColumn: number;
		lastColumn: number;
		firstRow: number;
		lastRow: number;
	} => ({
		firstColumn: Math.floor(
			(Math.min(ax, bx) - grid.origin.x) / grid.lattice.colPitch,
		),
		lastColumn: Math.floor(
			(Math.max(ax, bx) - grid.origin.x) / grid.lattice.colPitch,
		),
		firstRow: Math.floor(
			(Math.min(ay, by) - grid.origin.y) / grid.lattice.rowPitch,
		),
		lastRow: Math.floor(
			(Math.max(ay, by) - grid.origin.y) / grid.lattice.rowPitch,
		),
	});
	/** Arrows too long to index cheaply. Always compared. */
	const sprawlingEdges: number[] = [];
	const rebuildEdgeIndex = (): void => {
		edgeBuckets.clear();
		sprawlingEdges.length = 0;
		for (let edge = 0; edge < edgeCount; edge += 1) {
			const a = edgeA[edge];
			const b = edgeB[edge];
			const span = edgeCells(centreX[a], centreY[a], centreX[b], centreY[b]);
			const cells =
				(span.lastColumn - span.firstColumn + 1) *
				(span.lastRow - span.firstRow + 1);
			if (cells > MAX_OBSTACLE_CELLS) {
				sprawlingEdges.push(edge);
				continue;
			}
			for (
				let column = span.firstColumn;
				column <= span.lastColumn;
				column += 1
			) {
				for (let row = span.firstRow; row <= span.lastRow; row += 1) {
					const key = cellKey(column, row);
					const bucket = edgeBuckets.get(key);
					if (bucket) bucket.push(edge);
					else edgeBuckets.set(key, [edge]);
				}
			}
		}
	};
	const edgeStamp = new Int32Array(edgeCount).fill(-1);
	let edgeQuery = 0;
	const nearbyEdges: number[] = [];
	const collectNearbyEdges = (
		ax: number,
		ay: number,
		bx: number,
		by: number,
	): void => {
		nearbyEdges.length = 0;
		edgeQuery += 1;
		const span = edgeCells(ax, ay, bx, by);
		for (
			let column = span.firstColumn;
			column <= span.lastColumn;
			column += 1
		) {
			for (let row = span.firstRow; row <= span.lastRow; row += 1) {
				const bucket = edgeBuckets.get(cellKey(column, row));
				if (!bucket) continue;
				for (const edge of bucket) {
					if (edgeStamp[edge] === edgeQuery) continue;
					edgeStamp[edge] = edgeQuery;
					nearbyEdges.push(edge);
				}
			}
		}
		for (const edge of sprawlingEdges) {
			if (edgeStamp[edge] === edgeQuery) continue;
			edgeStamp[edge] = edgeQuery;
			nearbyEdges.push(edge);
		}
	};
	rebuildEdgeIndex();

	const crossingCost = (edge: number, other: number): number => {
		const a = edgeA[edge];
		const b = edgeB[edge];
		const c = edgeA[other];
		const d = edgeB[other];
		if (c === a || c === b || d === a || d === b) return 0;
		if (
			!segmentsCross(
				centreX[a],
				centreY[a],
				centreX[b],
				centreY[b],
				centreX[c],
				centreY[c],
				centreX[d],
				centreY[d],
			)
		) {
			return 0;
		}
		defects += 1;
		return COST_CROSSING;
	};

	const costAround = (touched: readonly number[]): number => {
		const affected = new Set<number>();
		for (const node of touched) {
			for (const edge of incident[node]) affected.add(edge);
		}
		let cost = 0;
		defects = 0;
		// Affected arrows have moved, so the index cannot be trusted for them:
		// compare every affected pair directly, once each.
		const affectedList = [...affected];
		for (let first = 0; first < affectedList.length; first += 1) {
			for (let second = first + 1; second < affectedList.length; second += 1) {
				cost += crossingCost(affectedList[first], affectedList[second]);
			}
		}
		for (const edge of affected) {
			const a = edgeA[edge];
			const b = edgeB[edge];
			const ax = centreX[a];
			const ay = centreY[a];
			const bx = centreX[b];
			const by = centreY[b];
			const length = Math.hypot(bx - ax, by - ay);
			cost += COST_PER_PIXEL * length;
			if (length < roomNeeded[edge]) {
				cost += COST_CRAMPED_SPOKE * (1 - length / roomNeeded[edge]);
				// Counts as a defect, so the skip-clean-cards shortcut below still
				// looks at a card whose only problem is that it is crowded.
				defects += 1;
			}
			collectNearbyEdges(ax, ay, bx, by);
			for (const other of nearbyEdges) {
				if (other === edge || affected.has(other)) continue;
				cost += crossingCost(edge, other);
			}
			collectNearbyCards(ax, ay, bx, by);
			for (const card of nearbyCards) {
				if (card === a || card === b) continue;
				if (
					segmentHitsRect(
						ax,
						ay,
						bx,
						by,
						left[card],
						top[card],
						widths[card],
						heights[card],
					)
				) {
					cost += COST_THROUGH_CARD;
					defects += 1;
				}
			}
		}
		// Arrows that do not touch these cards can still be driven through them.
		for (const card of touched) {
			collectNearbyEdges(
				left[card],
				top[card],
				left[card] + widths[card],
				top[card] + heights[card],
			);
			for (const edge of nearbyEdges) {
				if (affected.has(edge)) continue;
				const a = edgeA[edge];
				const b = edgeB[edge];
				if (card === a || card === b) continue;
				if (
					segmentHitsRect(
						centreX[a],
						centreY[a],
						centreX[b],
						centreY[b],
						left[card],
						top[card],
						widths[card],
						heights[card],
					)
				) {
					cost += COST_THROUGH_CARD;
					defects += 1;
				}
			}
		}
		return cost;
	};

	for (let sweep = 0; sweep < MAX_REFINE_SWEEPS; sweep += 1) {
		let changes = 0;
		for (let node = 0; node < count; node += 1) {
			const homeColumn = grid.column[node];
			const homeRow = grid.row[node];
			const soloBefore = costAround([node]);
			// A card whose arrows cross nothing and pierce nothing has nothing to
			// gain here: moving it can only add defects or change length. Skipping
			// those is what keeps the later sweeps cheap.
			if (defects === 0) continue;
			let bestDelta = 0;
			let bestColumn = homeColumn;
			let bestRow = homeRow;
			let bestPartner = -1;

			for (let dc = -REFINE_RADIUS; dc <= REFINE_RADIUS; dc += 1) {
				for (let dr = -REFINE_RADIUS; dr <= REFINE_RADIUS; dr += 1) {
					if (dc === 0 && dr === 0) continue;
					const column = homeColumn + dc;
					const row = homeRow + dr;
					const partner = grid.occupant.get(cellKey(column, row));

					if (partner === undefined) {
						liftFromGrid(grid, node);
						if (fitsOnGrid(grid, node, column, row)) {
							dropOnGrid(grid, node, column, row);
							const delta = costAround([node]) - soloBefore;
							liftFromGrid(grid, node);
							if (delta < bestDelta) {
								bestDelta = delta;
								bestColumn = column;
								bestRow = row;
								bestPartner = -1;
							}
						}
						dropOnGrid(grid, node, homeColumn, homeRow);
						continue;
					}
					if (partner === node) continue;

					const partnerColumn = grid.column[partner];
					const partnerRow = grid.row[partner];
					const pairBefore = costAround([node, partner]);
					liftFromGrid(grid, node);
					liftFromGrid(grid, partner);
					if (
						fitsOnGrid(grid, node, partnerColumn, partnerRow) &&
						fitsOnGrid(grid, partner, homeColumn, homeRow)
					) {
						dropOnGrid(grid, node, partnerColumn, partnerRow);
						dropOnGrid(grid, partner, homeColumn, homeRow);
						const delta = costAround([node, partner]) - pairBefore;
						liftFromGrid(grid, node);
						liftFromGrid(grid, partner);
						if (delta < bestDelta) {
							bestDelta = delta;
							bestColumn = partnerColumn;
							bestRow = partnerRow;
							bestPartner = partner;
						}
					}
					dropOnGrid(grid, node, homeColumn, homeRow);
					dropOnGrid(grid, partner, partnerColumn, partnerRow);
				}
			}

			if (bestDelta >= 0) continue;
			if (bestPartner === -1) {
				liftFromGrid(grid, node);
				dropOnGrid(grid, node, bestColumn, bestRow);
			} else {
				liftFromGrid(grid, node);
				liftFromGrid(grid, bestPartner);
				dropOnGrid(grid, node, bestColumn, bestRow);
				dropOnGrid(grid, bestPartner, homeColumn, homeRow);
			}
			rebuildEdgeIndex();
			changes += 1;
		}
		if (changes === 0) break;
	}
}

/**
 * Moves every laid-out card onto a cell of one shared grid, then untangles it.
 *
 * The grid is what makes the arrangement read as organised rather than as a
 * cloud: the stress solver decides *where* cards belong relative to one
 * another, and the grid forces those positions onto a handful of shared columns
 * and rows, so card edges line up across the whole board and a good share of
 * the arrows come out exactly horizontal or vertical.
 *
 * Cards claim cells nearest-the-centre first, which keeps the dense core of the
 * graph on the cells the solver picked for it and pushes the compromises out to
 * the sparse rim. Obstacles do not move: they simply block the cells they cover,
 * so the arrangement flows around them instead of the whole board sliding to
 * dodge one stray card. `refineGridPlacement` then shuffles cards between cells
 * to pull the arrows apart.
 */
export function snapGraphToLattice(
	frames: Map<string, Frame>,
	edges: readonly ArrangeEdge[],
	obstacles: readonly Frame[],
): void {
	if (frames.size === 0) return;
	const entries = [...frames]
		.map(([id, frame]) => ({ id, frame }))
		.sort((a, b) => compareIds(a.id, b.id));
	const lattice = latticeFor(entries.map((entry) => entry.frame));

	// Anchor the grid on the arrangement's own centre of mass, so snapping keeps
	// the recentring the caller already did instead of drifting off it.
	let weight = 0;
	let centreX = 0;
	let centreY = 0;
	for (const { frame } of entries) {
		const area = Math.max(frame.w * frame.h, 1);
		weight += area;
		centreX += (frame.x + frame.w / 2) * area;
		centreY += (frame.y + frame.h / 2) * area;
	}
	const origin: Point = {
		x: centreX / weight - lattice.colPitch / 2,
		y: centreY / weight - lattice.rowPitch / 2,
	};

	const blocked = new Set<string>();
	for (const obstacle of obstacles) {
		cellsUnder(obstacle, origin, lattice, blocked);
	}

	const indexById = new Map(entries.map((entry, index) => [entry.id, index]));
	const grid: Grid = {
		lattice,
		origin,
		blocked,
		occupant: new Map(),
		column: entries.map(() => 0),
		row: entries.map(() => 0),
		spanColumns: entries.map((entry) =>
			Math.max(1, Math.ceil((entry.frame.w + GAP_MAIN) / lattice.colPitch)),
		),
		spanRows: entries.map((entry) =>
			Math.max(1, Math.ceil((entry.frame.h + GAP_CROSS) / lattice.rowPitch)),
		),
		widths: entries.map((entry) => entry.frame.w),
		heights: entries.map((entry) => entry.frame.h),
		left: entries.map(() => 0),
		top: entries.map(() => 0),
		centreX: entries.map(() => 0),
		centreY: entries.map(() => 0),
	};

	const order = [...entries].sort((a, b) => {
		const first =
			(a.frame.x + a.frame.w / 2 - origin.x - lattice.colPitch / 2) ** 2 +
			(a.frame.y + a.frame.h / 2 - origin.y - lattice.rowPitch / 2) ** 2;
		const second =
			(b.frame.x + b.frame.w / 2 - origin.x - lattice.colPitch / 2) ** 2 +
			(b.frame.y + b.frame.h / 2 - origin.y - lattice.rowPitch / 2) ** 2;
		return first - second || compareIds(a.id, b.id);
	});

	for (const { id, frame } of order) {
		const index = indexById.get(id) as number;
		const wantedColumn = Math.round((frame.x - origin.x) / lattice.colPitch);
		const wantedRow = Math.round((frame.y - origin.y) / lattice.rowPitch);
		const isFree = (column: number, row: number) =>
			fitsOnGrid(grid, index, column, row);

		let column = wantedColumn;
		let row = wantedRow;
		for (let ring = 0; ring <= MAX_LATTICE_RINGS; ring += 1) {
			const candidates: { column: number; row: number; distance: number }[] =
				[];
			for (let dx = -ring; dx <= ring; dx += 1) {
				for (let dy = -ring; dy <= ring; dy += 1) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
					candidates.push({
						column: wantedColumn + dx,
						row: wantedRow + dy,
						distance:
							(dx * lattice.colPitch) ** 2 + (dy * lattice.rowPitch) ** 2,
					});
				}
			}
			candidates.sort(
				(a, b) =>
					a.distance - b.distance || a.column - b.column || a.row - b.row,
			);
			const spot = candidates.find((candidate) =>
				isFree(candidate.column, candidate.row),
			);
			if (spot) {
				column = spot.column;
				row = spot.row;
				break;
			}
		}

		dropOnGrid(grid, index, column, row);
	}

	const edgeA: number[] = [];
	const edgeB: number[] = [];
	for (const edge of edges) {
		const a = indexById.get(edge.source);
		const b = indexById.get(edge.target);
		if (a === undefined || b === undefined || a === b) continue;
		edgeA.push(a);
		edgeB.push(b);
	}
	refineGridPlacement(grid, edgeA, edgeB);

	for (let index = 0; index < entries.length; index += 1) {
		frames.set(entries[index].id, {
			x: origin.x + grid.column[index] * lattice.colPitch,
			y: origin.y + grid.row[index] * lattice.rowPitch,
			w: grid.widths[index],
			h: grid.heights[index],
		});
	}
}
