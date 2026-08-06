import { describe, expect, test } from "vitest";
import {
	type ArrangeEdge,
	type ArrangeNode,
	arrangeRelationLayout,
} from "./arrange-relations";
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
});
