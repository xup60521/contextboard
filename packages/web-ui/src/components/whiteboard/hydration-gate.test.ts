import { describe, expect, test, vi } from "vitest";
import {
	createHydrationGate,
	releaseHydrationAfterStoreFlush,
} from "./hydration-gate";

describe("HydrationGate", () => {
	test("remains active until all overlapping entrants release", () => {
		const gate = createHydrationGate();
		const releaseA = gate.enter();
		const releaseB = gate.enter();
		expect(gate.current).toBe(true);
		releaseA();
		expect(gate.current).toBe(true);
		releaseA();
		expect(gate.current).toBe(true);
		releaseB();
		expect(gate.current).toBe(false);
	});

	test("makes tldraw follow-up notification release explicit", () => {
		vi.useFakeTimers();
		const gate = createHydrationGate();
		const release = gate.enter();
		releaseHydrationAfterStoreFlush(release);
		expect(gate.current).toBe(true);
		vi.runAllTimers();
		expect(gate.current).toBe(false);
		vi.useRealTimers();
	});
});
