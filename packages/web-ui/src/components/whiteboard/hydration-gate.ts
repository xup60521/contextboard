import type { MutableRefObject } from "react";

export type HydrationRef = MutableRefObject<boolean> & {
	enter?: () => () => void;
	reset?: () => void;
};

/** Reference-counted guard for overlapping tldraw hydration transactions. */
export function createHydrationGate(): Required<HydrationRef> {
	let depth = 0;
	return {
		get current() {
			return depth > 0;
		},
		set current(active: boolean) {
			depth = active ? depth + 1 : Math.max(0, depth - 1);
		},
		enter() {
			depth += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				depth = Math.max(0, depth - 1);
			};
		},
		reset() {
			depth = 0;
		},
	};
}

export function enterHydration(ref: HydrationRef) {
	if (ref.enter) return ref.enter();
	ref.current = true;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		ref.current = false;
	};
}

/** tldraw can emit one follow-up store notification after `run` returns. */
export function releaseHydrationAfterStoreFlush(release: () => void) {
	globalThis.setTimeout(release, 0);
}
