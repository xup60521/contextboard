import { describe, expect, test } from "vitest";
import { type Frame, findFreeFrame } from "./place-card-frame";

const SIZE = { w: 576, h: 180 };

const overlap = (a: Frame, b: Frame) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("findFreeFrame", () => {
	test("puts the first card on the origin", () => {
		expect(findFreeFrame([], SIZE)).toEqual({ x: 0, y: 0, ...SIZE });
	});

	test("keeps clear of a single existing card", () => {
		const occupied = [{ x: 0, y: 0, ...SIZE }];
		const frame = findFreeFrame(occupied, SIZE);
		expect(overlap(frame, occupied[0])).toBe(false);
	});

	test("never overlaps as cards accumulate", () => {
		const occupied: Frame[] = [];
		for (let index = 0; index < 12; index += 1) {
			const frame = findFreeFrame(occupied, SIZE);
			for (const existing of occupied) {
				expect(overlap(frame, existing)).toBe(false);
			}
			occupied.push(frame);
		}
		expect(occupied).toHaveLength(12);
	});

	test("wraps onto a new row instead of growing one endless strip", () => {
		const occupied: Frame[] = [];
		for (let index = 0; index < 8; index += 1) {
			occupied.push(findFreeFrame(occupied, SIZE));
		}
		expect(new Set(occupied.map((frame) => frame.y)).size).toBeGreaterThan(1);
	});

	test("fills a hole left in a full row", () => {
		// A full first row, and a second row missing its leftmost slot.
		const step = { x: SIZE.w + 48, y: SIZE.h + 48 };
		const occupied: Frame[] = [];
		for (let column = 0; column < 4; column += 1) {
			occupied.push({ x: column * step.x, y: 0, ...SIZE });
			if (column > 0) {
				occupied.push({ x: column * step.x, y: step.y, ...SIZE });
			}
		}
		expect(findFreeFrame(occupied, SIZE)).toEqual({ x: 0, y: step.y, ...SIZE });
	});

	test("falls back below everything when the scanned region is full", () => {
		// One very wide card: no grid slot beside it fits within the scan, so the
		// helper must still return something free rather than give up.
		const occupied = [{ x: 0, y: 0, w: 20_000, h: 400 }];
		const frame = findFreeFrame(occupied, SIZE);
		expect(overlap(frame, occupied[0])).toBe(false);
		expect(frame.y).toBeGreaterThanOrEqual(400);
	});

	test("is deterministic", () => {
		const occupied = [
			{ x: 10, y: 20, ...SIZE },
			{ x: 900, y: 400, ...SIZE },
		];
		expect(findFreeFrame(occupied, SIZE)).toEqual(
			findFreeFrame(occupied, SIZE),
		);
	});

	test("respects the requested size", () => {
		const frame = findFreeFrame([{ x: 0, y: 0, ...SIZE }], { w: 300, h: 100 });
		expect(frame).toMatchObject({ w: 300, h: 100 });
	});
});
