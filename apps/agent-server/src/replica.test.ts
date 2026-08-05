import { afterEach, describe, expect, test, vi } from "vitest";
import { startReplicaSyncLoop } from "./replica-sync-loop";

describe("replica sync loop", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("polls on a recursive timer without overlapping sync runs", async () => {
		vi.useFakeTimers();
		let releaseFirst!: () => void;
		const firstSync = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const sync = vi
			.fn<() => Promise<void>>()
			.mockImplementationOnce(() => firstSync)
			.mockResolvedValue(undefined);
		const stop = startReplicaSyncLoop({ sync });

		await vi.advanceTimersByTimeAsync(2_000);
		expect(sync).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(10_000);
		expect(sync).toHaveBeenCalledTimes(1);

		releaseFirst();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(sync).toHaveBeenCalledTimes(2);

		stop();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(sync).toHaveBeenCalledTimes(2);
	});

	test("uses retry delay after a failed sync and stops cleanly", async () => {
		vi.useFakeTimers();
		const error = new Error("temporary remote failure");
		const sync = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
		const onError = vi.fn();
		const retryDelay = vi.fn(() => 5_000);
		const stop = startReplicaSyncLoop({ sync, retryDelay, onError });

		await vi.advanceTimersByTimeAsync(2_000);
		expect(sync).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(error);
		expect(retryDelay).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(4_999);
		expect(sync).toHaveBeenCalledTimes(1);

		stop();
		await vi.advanceTimersByTimeAsync(1_001);
		expect(sync).toHaveBeenCalledTimes(1);
	});
});
