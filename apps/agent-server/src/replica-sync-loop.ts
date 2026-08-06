export type ReplicaSyncLoopOptions = {
	sync: () => Promise<void>;
	intervalMs?: number;
	retryDelay?: () => number;
	onError?: (error: unknown) => void;
};

/**
 * Keep a long-lived headless replica current without overlapping sync runs.
 * A recursive timeout lets callers use a longer retry delay after failures and
 * makes shutdown deterministic: a stopped loop never schedules another pull.
 */
export function startReplicaSyncLoop(options: ReplicaSyncLoopOptions) {
	const intervalMs = Math.max(1, options.intervalMs ?? 2_000);
	let stopped = false;
	let running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const schedule = (delay: number) => {
		if (stopped) return;
		timer = setTimeout(() => {
			timer = undefined;
			void run();
		}, Math.max(1, delay));
	};

	const run = async () => {
		if (stopped || running) return;
		running = true;
		let failed = false;
		try {
			await options.sync();
		} catch (error) {
			failed = true;
			options.onError?.(error);
		} finally {
			running = false;
			schedule(
				failed ? (options.retryDelay?.() ?? intervalMs) : intervalMs,
			);
		}
	};

	schedule(intervalMs);
	return () => {
		stopped = true;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	};
}
