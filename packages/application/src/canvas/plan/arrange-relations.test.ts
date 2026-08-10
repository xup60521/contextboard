import { describe, expect, test } from "vitest";
import {
	type ArrangeEdge,
	type ArrangeNode,
	arrangeRelationLayout,
} from "./arrange-relations";
import researchGraph from "./arrange-relations.fixture.json";
import type { Frame } from "./place-card-frame";

const CARD = { w: 576, h: 180 };

function card(id: string, x = 0, y = 0, size = CARD): ArrangeNode {
	return { id, x, y, ...size };
}

/** The frames the layout produced, for every node it moved or left in place. */
function framesOf(
	nodes: readonly ArrangeNode[],
	result: ReturnType<typeof arrangeRelationLayout>,
): Map<string, Frame> {
	const frames = new Map<string, Frame>();
	for (const node of nodes) {
		const moved = result.positions.get(node.id);
		frames.set(node.id, {
			x: moved?.x ?? node.x,
			y: moved?.y ?? node.y,
			w: node.w,
			h: node.h,
		});
	}
	return frames;
}

const overlap = (a: Frame, b: Frame) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectNoOverlaps(frames: Iterable<Frame>) {
	const list = [...frames];
	for (let i = 0; i < list.length; i += 1) {
		for (let j = i + 1; j < list.length; j += 1) {
			expect([i, j, overlap(list[i], list[j])]).toEqual([i, j, false]);
		}
	}
}

function centreOfMass(frames: readonly Frame[]) {
	let weight = 0;
	let x = 0;
	let y = 0;
	for (const frame of frames) {
		const area = frame.w * frame.h;
		weight += area;
		x += (frame.x + frame.w / 2) * area;
		y += (frame.y + frame.h / 2) * area;
	}
	return { x: x / weight, y: y / weight };
}

describe("arrangeRelationLayout", () => {
	test("lays a chain out left to right, one card per layer", () => {
		const nodes = [card("a"), card("b", 900, 700), card("c", -400, 300)];
		const edges: ArrangeEdge[] = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
		];

		const result = arrangeRelationLayout(nodes, edges);
		const frames = framesOf(nodes, result);
		expect(result.style).toBe("tree-horizontal");

		const a = frames.get("a") as Frame;
		const b = frames.get("b") as Frame;
		const c = frames.get("c") as Frame;
		expect(a.x).toBeLessThan(b.x);
		expect(b.x).toBeLessThan(c.x);
		// A chain has one card per layer, so nothing is staggered on the cross axis.
		expect(a.y).toBe(b.y);
		expect(b.y).toBe(c.y);
		expectNoOverlaps(frames.values());
	});

	test("picks a mindmap for a single well-branched hub", () => {
		const nodes = [card("root"), ...["a", "b", "c", "d"].map((id) => card(id))];
		const edges: ArrangeEdge[] = [
			{ source: "root", target: "a" },
			{ source: "root", target: "b" },
			{ source: "root", target: "c" },
			{ source: "root", target: "d" },
			// Depth 2 is what makes it worth splitting into two halves.
			{ source: "a", target: "leaf" },
		];
		const all = [...nodes, card("leaf")];

		const result = arrangeRelationLayout(all, edges);
		expect(result.style).toBe("mindmap");

		const frames = framesOf(all, result);
		const root = frames.get("root") as Frame;
		const children = ["a", "b", "c", "d"].map((id) => frames.get(id) as Frame);
		expect(children.some((frame) => frame.x < root.x)).toBe(true);
		expect(children.some((frame) => frame.x > root.x)).toBe(true);
		expectNoOverlaps(frames.values());
	});

	test("a shallow hub stays a plain tree", () => {
		const nodes = ["root", "a", "b", "c"].map((id) => card(id));
		const result = arrangeRelationLayout(nodes, [
			{ source: "root", target: "a" },
			{ source: "root", target: "b" },
			{ source: "root", target: "c" },
		]);
		expect(result.style).toBe("tree-horizontal");
	});

	test("stacks unrelated groups instead of overlapping them", () => {
		const nodes = ["a", "b", "c", "d"].map((id) => card(id));
		const result = arrangeRelationLayout(nodes, [
			{ source: "a", target: "b" },
			{ source: "c", target: "d" },
		]);
		const frames = framesOf(nodes, result);
		expectNoOverlaps(frames.values());
		// Both groups start at the same column, separated on the cross axis.
		expect((frames.get("a") as Frame).x).toBe((frames.get("c") as Frame).x);
		expect((frames.get("a") as Frame).y).not.toBe((frames.get("c") as Frame).y);
	});

	test("leaves cards with no relation exactly where they are", () => {
		const nodes = [card("a"), card("b"), card("lonely", 4321, 1234)];
		const result = arrangeRelationLayout(nodes, [{ source: "a", target: "b" }]);
		expect(result.skippedIds).toEqual(["lonely"]);
		expect(result.positions.has("lonely")).toBe(false);
	});

	test("nothing to do when the selection has no relations at all", () => {
		const nodes = [card("a"), card("b", 500)];
		const result = arrangeRelationLayout(nodes, []);
		expect(result.positions.size).toBe(0);
		expect(result.skippedIds).toEqual(["a", "b"]);
	});

	test("lays out a pure cycle by drafting a root", () => {
		const nodes = ["a", "b", "c"].map((id) => card(id));
		const result = arrangeRelationLayout(nodes, [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
			{ source: "c", target: "a" },
		]);
		const frames = framesOf(nodes, result);
		expect(result.skippedIds).toEqual([]);
		expectNoOverlaps(frames.values());
	});

	test("reaches nodes only entered through a cycle", () => {
		// `a` is the only source-only card, but `c`/`d` cycle between themselves.
		const nodes = ["a", "b", "c", "d"].map((id) => card(id));
		const result = arrangeRelationLayout(nodes, [
			{ source: "a", target: "b" },
			{ source: "c", target: "d" },
			{ source: "d", target: "c" },
			{ source: "c", target: "b" },
		]);
		const frames = framesOf(nodes, result);
		expect(result.skippedIds).toEqual([]);
		expectNoOverlaps(frames.values());
	});

	test("keeps the centre of mass where it was", () => {
		const nodes = [
			card("root", 1000, 2000),
			card("a", 1600, 1800),
			card("b", 1600, 2200),
			card("c", 2200, 2000),
		];
		const before = centreOfMass(nodes);
		const result = arrangeRelationLayout(nodes, [
			{ source: "root", target: "a" },
			{ source: "root", target: "b" },
			{ source: "a", target: "c" },
		]);
		const after = centreOfMass([...framesOf(nodes, result).values()]);
		// Frames are rounded to whole pixels, so the centre can drift half a pixel.
		expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
	});

	test("slides clear of an obstacle rather than covering it", () => {
		const nodes = [card("a", 0, 0), card("b", 700, 0)];
		const obstacle: Frame = { x: -200, y: -100, w: 2000, h: 400 };
		const result = arrangeRelationLayout(
			nodes,
			[{ source: "a", target: "b" }],
			{ obstacles: [obstacle] },
		);
		for (const frame of framesOf(nodes, result).values()) {
			expect(overlap(frame, obstacle)).toBe(false);
		}
	});

	test("would rather overlap than fling the cards across the board", () => {
		const nodes = [card("a", 0, 0), card("b", 700, 0)];
		// Clearing this would cost thousands of pixels, so the layout stays put.
		const obstacles: Frame[] = [
			{ x: -10_000, y: -10_000, w: 20_000, h: 20_000 },
		];
		const result = arrangeRelationLayout(
			nodes,
			[{ source: "a", target: "b" }],
			{ obstacles },
		);
		const centred = arrangeRelationLayout(nodes, [
			{ source: "a", target: "b" },
		]);
		expect([...result.positions]).toEqual([...centred.positions]);
	});

	test("respects an explicit vertical style", () => {
		const nodes = ["root", "a", "b"].map((id) => card(id));
		const result = arrangeRelationLayout(
			nodes,
			[
				{ source: "root", target: "a" },
				{ source: "root", target: "b" },
			],
			{ style: "tree-vertical" },
		);
		expect(result.style).toBe("tree-vertical");
		const frames = framesOf(nodes, result);
		expect((frames.get("root") as Frame).y).toBeLessThan(
			(frames.get("a") as Frame).y,
		);
		expect((frames.get("a") as Frame).y).toBe((frames.get("b") as Frame).y);
	});

	test("handles cards of very different heights without overlapping", () => {
		const nodes = [
			card("root", 0, 0, { w: 576, h: 96 }),
			card("a", 0, 0, { w: 576, h: 900 }),
			card("b", 0, 0, { w: 300, h: 120 }),
			card("c", 0, 0, { w: 800, h: 400 }),
		];
		const result = arrangeRelationLayout(nodes, [
			{ source: "root", target: "a" },
			{ source: "root", target: "b" },
			{ source: "a", target: "c" },
		]);
		expectNoOverlaps(framesOf(nodes, result).values());
	});

	test("ignores self-loops, duplicates and edges pointing outside the set", () => {
		const nodes = [card("a"), card("b")];
		const result = arrangeRelationLayout(nodes, [
			{ source: "a", target: "a" },
			{ source: "a", target: "b" },
			{ source: "a", target: "b" },
			{ source: "b", target: "elsewhere" },
		]);
		expect(result.skippedIds).toEqual([]);
		expect(framesOf(nodes, result).size).toBe(2);
	});

	test("is deterministic however the input is ordered", () => {
		const nodes = ["root", "a", "b", "c", "d"].map((id, index) =>
			card(id, index * 37, index * 53),
		);
		const edges: ArrangeEdge[] = [
			{ source: "root", target: "a" },
			{ source: "root", target: "b" },
			{ source: "a", target: "c" },
			{ source: "b", target: "d" },
		];
		const first = arrangeRelationLayout(nodes, edges);
		const shuffled = arrangeRelationLayout(
			[...nodes].reverse(),
			[...edges].reverse(),
		);
		expect([...shuffled.positions].sort()).toEqual([...first.positions].sort());
	});

	test("keeps a dense 200-card graph compact, local, deterministic, and clear", () => {
		const graphNodes = Array.from({ length: 200 }, (_, index) =>
			card(
				`node-${index.toString().padStart(3, "0")}`,
				(index % 12) * 700,
				Math.floor(index / 12) * 2100,
				{ w: 576, h: 180 + (index % 5) * 40 },
			),
		);
		const graphEdges: ArrangeEdge[] = [];
		for (let index = 1; index < graphNodes.length; index += 1) {
			graphEdges.push({
				source: `node-${Math.floor((index - 1) / 2)
					.toString()
					.padStart(3, "0")}`,
				target: `node-${index.toString().padStart(3, "0")}`,
			});
		}
		// 260 undirected edges is about 1.3x the spanning-tree density.
		for (let index = 0; index < 61; index += 1) {
			graphEdges.push({
				source: `node-${index.toString().padStart(3, "0")}`,
				target: `node-${(index + 37).toString().padStart(3, "0")}`,
			});
		}
		const obstacles: Frame[] = Array.from({ length: 20 }, (_, index) => ({
			x: (index % 5) * 2400,
			y: Math.floor(index / 5) * 2400,
			w: 576,
			h: 300,
		}));

		const first = arrangeRelationLayout(graphNodes, graphEdges, { obstacles });
		const second = arrangeRelationLayout(graphNodes, graphEdges, { obstacles });
		expect(first.style).toBe("graph");
		expect([...second.positions]).toEqual([...first.positions]);

		const frames = framesOf(graphNodes, first);
		expectNoOverlaps(frames.values());
		for (const frame of frames.values()) {
			for (const obstacle of obstacles)
				expect(overlap(frame, obstacle)).toBe(false);
		}

		const values = [...frames.values()];
		const minX = Math.min(...values.map((frame) => frame.x));
		const minY = Math.min(...values.map((frame) => frame.y));
		const maxX = Math.max(...values.map((frame) => frame.x + frame.w));
		const maxY = Math.max(...values.map((frame) => frame.y + frame.h));
		const ratio = (maxX - minX) / (maxY - minY);
		expect(ratio).toBeGreaterThanOrEqual(0.4);
		expect(ratio).toBeLessThanOrEqual(2.5);

		// One column of the graph grid. The longest arrows are hub spokes, which
		// are deliberately stretched to give busy cards room to fan out.
		const idealLength = 576 + 360;
		let maxEdgeLength = 0;
		for (const edge of graphEdges) {
			const source = frames.get(edge.source) as Frame;
			const target = frames.get(edge.target) as Frame;
			maxEdgeLength = Math.max(
				maxEdgeLength,
				Math.hypot(
					source.x + source.w / 2 - target.x - target.w / 2,
					source.y + source.h / 2 - target.y - target.h / 2,
				),
			);
		}
		expect(maxEdgeLength).toBeLessThan(10 * idealLength);
	});

	test("repairs the real 249-card research graph regression fixture", () => {
		expect(researchGraph.nodes).toHaveLength(249);
		expect(researchGraph.edges).toHaveLength(254);
		expect(
			Math.max(...researchGraph.nodes.map((node) => node.x)) -
				Math.min(...researchGraph.nodes.map((node) => node.x)),
		).toBe(4176);
		expect(
			Math.max(...researchGraph.nodes.map((node) => node.y)) -
				Math.min(...researchGraph.nodes.map((node) => node.y)),
		).toBe(35_948);

		const result = arrangeRelationLayout(
			researchGraph.nodes,
			researchGraph.edges,
		);
		expect(result.style).toBe("graph");
		expect(result.skippedIds).toHaveLength(51);
		const frames = framesOf(researchGraph.nodes, result);
		const relatedIds = new Set(
			researchGraph.edges.flatMap((edge) => [edge.source, edge.target]),
		);
		const relatedFrames = [...frames]
			.filter(([id]) => relatedIds.has(id))
			.map(([, frame]) => frame);
		expectNoOverlaps(relatedFrames);
		for (const [id, frame] of frames) {
			if (!relatedIds.has(id)) continue;
			for (const [otherId, obstacle] of frames) {
				if (relatedIds.has(otherId)) continue;
				expect(overlap(frame, obstacle)).toBe(false);
			}
		}

		const minX = Math.min(...relatedFrames.map((frame) => frame.x));
		const minY = Math.min(...relatedFrames.map((frame) => frame.y));
		const maxX = Math.max(...relatedFrames.map((frame) => frame.x + frame.w));
		const maxY = Math.max(...relatedFrames.map((frame) => frame.y + frame.h));
		const width = maxX - minX;
		const height = maxY - minY;
		expect(width).toBeLessThan(22_000);
		expect(height).toBeLessThan(22_000);
		expect(width / height).toBeGreaterThanOrEqual(0.4);
		expect(width / height).toBeLessThanOrEqual(2.5);
		// The whole board lands on one shared grid: a handful of columns and rows
		// that every card lines up with. This is what separates the arrangement
		// from a force-directed cloud, so assert it tightly.
		const sharedCount = (values: readonly number[]) => {
			const counts = new Map<number, number>();
			for (const value of values)
				counts.set(value, (counts.get(value) ?? 0) + 1);
			return [...counts.values()]
				.filter((count) => count > 1)
				.reduce((sum, count) => sum + count, 0);
		};
		const xValues = relatedFrames.map((frame) => frame.x);
		const yValues = relatedFrames.map((frame) => frame.y);
		expect(new Set(xValues).size).toBeLessThanOrEqual(30);
		expect(new Set(yValues).size).toBeLessThanOrEqual(40);
		// Almost every card shares its column and its row with another card.
		expect(sharedCount(xValues)).toBeGreaterThanOrEqual(190);
		expect(sharedCount(yValues)).toBeGreaterThanOrEqual(180);
		// Columns and rows are evenly pitched, not merely clustered.
		const pitchOf = (values: readonly number[]) => {
			const distinct = [...new Set(values)].sort((a, b) => a - b);
			const steps = distinct
				.slice(1)
				.map((value, index) => value - distinct[index]);
			return Math.min(...steps);
		};
		for (const value of xValues) {
			expect((value - Math.min(...xValues)) % pitchOf(xValues)).toBe(0);
		}
		for (const value of yValues) {
			expect((value - Math.min(...yValues)) % pitchOf(yValues)).toBe(0);
		}
		// A good share of arrows therefore come out exactly horizontal or vertical.
		const axisAligned = researchGraph.edges.filter((edge) => {
			const source = frames.get(edge.source) as Frame;
			const target = frames.get(edge.target) as Frame;
			return source.x === target.x || source.y === target.y;
		});
		expect(axisAligned.length).toBeGreaterThanOrEqual(60);

		const edgeLengths = researchGraph.edges
			.map((edge) => {
				const source = frames.get(edge.source) as Frame;
				const target = frames.get(edge.target) as Frame;
				return Math.hypot(
					source.x + source.w / 2 - target.x - target.w / 2,
					source.y + source.h / 2 - target.y - target.h / 2,
				);
			})
			.sort((a, b) => a - b);
		expect(edgeLengths[Math.floor(edgeLengths.length / 2)]).toBeLessThan(2000);
		expect(edgeLengths[Math.floor(edgeLengths.length * 0.95)]).toBeLessThan(
			5500,
		);
		// The longest arrows are the hub spokes, deliberately stretched below.
		expect(edgeLengths.at(-1)).toBeLessThan(9000);

		// Cards busier than `HUB_MIN_DEGREE` (6) arrows are given a wider berth, so
		// their spokes have room to fan out instead of leaving in a smudge. Only a
		// handful of cards qualify on this board, and they were the worst tangles.
		const degree = new Map<string, number>();
		for (const edge of researchGraph.edges) {
			degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
			degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
		}
		// The room a card gets must scale with how connected it is, and keep
		// scaling — an earlier threshold-based version gave a card sitting just
		// under the cut-off no extra room at all, which is what this guards.
		// Measured as the tightest spoke on each card, averaged per degree.
		const neighbours = new Map<string, string[]>();
		for (const edge of researchGraph.edges) {
			for (const [from, to] of [
				[edge.source, edge.target],
				[edge.target, edge.source],
			]) {
				const list = neighbours.get(from);
				if (list) list.push(to);
				else neighbours.set(from, [to]);
			}
		}
		const meanTightestSpoke = (lowest: number, highest: number) => {
			const tightest: number[] = [];
			for (const [id, count] of degree) {
				if (count < lowest || count > highest) continue;
				const source = frames.get(id) as Frame;
				tightest.push(
					Math.min(
						...(neighbours.get(id) as string[]).map((other) => {
							const target = frames.get(other) as Frame;
							return Math.hypot(
								source.x + source.w / 2 - target.x - target.w / 2,
								source.y + source.h / 2 - target.y - target.h / 2,
							);
						}),
					),
				);
			}
			return tightest.reduce((sum, value) => sum + value, 0) / tightest.length;
		};
		const ordinary = meanTightestSpoke(3, 4);
		const connected = meanTightestSpoke(5, 6);
		const busiest = meanTightestSpoke(7, Number.POSITIVE_INFINITY);
		expect(connected).toBeGreaterThan(ordinary);
		expect(busiest).toBeGreaterThan(connected * 1.15);

		// ...but that berth belongs to the hub, not to whatever is on the far end
		// of each spoke. Charging both ends alike flings a hub's leaves out to the
		// distance its heaviest branch needed and hollows out that whole corner of
		// the board, so a leaf must end up markedly closer than a fellow hub does.
		const meanSpoke = (keep: (low: number, high: number) => boolean) => {
			const lengths = researchGraph.edges
				.filter((edge) =>
					keep(
						Math.min(
							degree.get(edge.source) ?? 0,
							degree.get(edge.target) ?? 0,
						),
						Math.max(
							degree.get(edge.source) ?? 0,
							degree.get(edge.target) ?? 0,
						),
					),
				)
				.map((edge) => {
					const source = frames.get(edge.source) as Frame;
					const target = frames.get(edge.target) as Frame;
					return Math.hypot(
						source.x + source.w / 2 - target.x - target.w / 2,
						source.y + source.h / 2 - target.y - target.h / 2,
					);
				});
			return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
		};
		const leafOfHub = meanSpoke((low, high) => low === 1 && high >= 5);
		const hubToHub = meanSpoke((low) => low >= 3);
		expect(leafOfHub).toBeLessThan(hubToHub * 0.8);

		// And the board must stay reasonably filled. Every knob that buys room
		// around hubs spends board area, and it is easy to spend it globally by
		// accident: the graph metric compounds along paths, so an uncapped hub
		// stretch inflates everything and leaves the corners empty.
		const cardArea = relatedFrames.reduce(
			(sum, frame) => sum + frame.w * frame.h,
			0,
		);
		expect(cardArea / (width * height)).toBeGreaterThan(0.13);

		// The refinement pass exists to untangle the arrows, so measure that
		// directly. Snapping alone leaves roughly one crossing per arrow.
		const centre = (id: string) => {
			const frame = frames.get(id) as Frame;
			return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
		};
		const side = (
			a: { x: number; y: number },
			b: { x: number; y: number },
			p: { x: number; y: number },
		) => (p.y - a.y) * (b.x - a.x) > (b.y - a.y) * (p.x - a.x);
		const cross = (
			a: { x: number; y: number },
			b: { x: number; y: number },
			c: { x: number; y: number },
			d: { x: number; y: number },
		) => side(a, c, d) !== side(b, c, d) && side(a, b, c) !== side(a, b, d);
		const segments = researchGraph.edges.map((edge) => ({
			source: edge.source,
			target: edge.target,
			from: centre(edge.source),
			to: centre(edge.target),
		}));
		let crossings = 0;
		for (let first = 0; first < segments.length; first += 1) {
			for (let second = first + 1; second < segments.length; second += 1) {
				const a = segments[first];
				const b = segments[second];
				const endpoints = new Set([a.source, a.target, b.source, b.target]);
				if (endpoints.size < 4) continue;
				if (cross(a.from, a.to, b.from, b.to)) crossings += 1;
			}
		}
		expect(crossings).toBeLessThanOrEqual(130);

		let throughCards = 0;
		for (const segment of segments) {
			for (const [id, frame] of frames) {
				if (id === segment.source || id === segment.target) continue;
				const corners = [
					{ x: frame.x, y: frame.y },
					{ x: frame.x + frame.w, y: frame.y },
					{ x: frame.x + frame.w, y: frame.y + frame.h },
					{ x: frame.x, y: frame.y + frame.h },
				];
				const pierced = corners.some((corner, index) =>
					cross(segment.from, segment.to, corner, corners[(index + 1) % 4]),
				);
				if (pierced) throughCards += 1;
			}
		}
		expect(throughCards).toBeLessThanOrEqual(70);
	});
});
