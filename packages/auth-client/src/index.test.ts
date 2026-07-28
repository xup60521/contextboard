// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import {
	AuthPopupError,
	signInWithGitHubPopup,
	waitForPopup,
} from "./index";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function popupFixture() {
	return {
		closed: false,
		close: vi.fn(),
	} as unknown as Window;
}

function completionEvent(
	popup: Window,
	origin = window.location.origin,
	error: string | null = null,
) {
	return new MessageEvent("message", {
		origin,
		source: popup,
		data: {
			type: "contextboard:auth-popup-complete",
			error,
		},
	});
}

describe("GitHub auth popup", () => {
	test("accepts only the same-origin message from the opened popup", async () => {
		const popup = popupFixture();
		const pending = waitForPopup(popup);
		window.dispatchEvent(
			completionEvent(popup, "https://attacker.example"),
		);
		window.dispatchEvent(
			completionEvent(popupFixture(), window.location.origin),
		);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		window.dispatchEvent(completionEvent(popup));
		await expect(pending).resolves.toBeUndefined();
	});

	test("reports OAuth errors and user cancellation", async () => {
		const popup = popupFixture();
		const failed = waitForPopup(popup);
		const failedAssertion = expect(failed).rejects.toThrow(
			"GitHub sign in failed: denied",
		);
		window.dispatchEvent(completionEvent(popup, window.location.origin, "denied"));
		await failedAssertion;

		vi.useFakeTimers();
		const cancelledPopup = popupFixture();
		Object.defineProperty(cancelledPopup, "closed", {
			value: true,
			configurable: true,
		});
		const cancelled = waitForPopup(cancelledPopup);
		const cancelledAssertion = expect(cancelled).rejects.toThrow(
			"Sign-in popup was closed",
		);
		await vi.advanceTimersByTimeAsync(400);
		await cancelledAssertion;
	});

	test("reports blocked popups and times out stalled OAuth", async () => {
		vi.spyOn(window, "open").mockReturnValue(null);
		await expect(signInWithGitHubPopup()).rejects.toBeInstanceOf(
			AuthPopupError,
		);

		vi.useFakeTimers();
		const popup = popupFixture();
		const timedOut = waitForPopup(popup);
		const timedOutAssertion = expect(timedOut).rejects.toThrow(
			"GitHub sign in timed out",
		);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		await timedOutAssertion;
		expect(popup.close).toHaveBeenCalledOnce();
	});
});
