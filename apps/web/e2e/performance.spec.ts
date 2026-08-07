import { expect, test } from "@playwright/test";
import {
	installPerformanceFixture,
	PERF_FIXTURE,
} from "./performance-fixture";

type PerfSnapshot = {
	counters: Record<string, number>;
	events: Array<{ metric: string; value: number; at: number; detail?: string }>;
};

async function perfSnapshot(page: import("@playwright/test").Page) {
	return page.evaluate(() =>
		(window as typeof window & {
			__contextboardPerf?: { snapshot(): PerfSnapshot };
		}).__contextboardPerf?.snapshot(),
	);
}

test("200-card reference fixture stays quiet while idle", async ({ page }) => {
	await installPerformanceFixture(page);
	await expect(page.locator(".tl-canvas")).toBeVisible();
	await expect
		.poll(async () => (await perfSnapshot(page))?.counters["canvas.items.reload"])
		.toBeGreaterThan(0);
	await expect
		.poll(async () => (await perfSnapshot(page))?.counters["canvas.shape.created"])
		.toBe(PERF_FIXTURE.cardCount + PERF_FIXTURE.childBoardCount);
	await page.waitForTimeout(500);
	await page.evaluate(() => window.__contextboardPerf?.reset());

	// Three seconds crosses the regression's unconditional two-second poll. The
	// full acceptance run uses 60 seconds without slowing every browser smoke run.
	await page.waitForTimeout(process.env.CONTEXTBOARD_FULL_PERF ? 60_000 : 3_000);
	const snapshot = await perfSnapshot(page);
	expect(snapshot).toBeDefined();
	for (const metric of [
		"repository.notification.emitted",
		"canvas.items.reload",
		"canvas.document.reload",
		"canvas.shape.created",
		"canvas.shape.deleted",
	]) {
		expect(snapshot?.counters[metric] ?? 0, metric).toBe(0);
	}
});

test("the deterministic fixture has the audited cardinalities", async ({ page }) => {
	await installPerformanceFixture(page, { pendingChangeCount: 10_000 });
	const counts = await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("contextboard");
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const names = [
			"cards",
			"cardContents",
			"canvasRecords",
			"whiteboards",
			"changeLog",
		];
		const transaction = database.transaction(names, "readonly");
		return Object.fromEntries(
			await Promise.all(
				names.map(
					(name) =>
						new Promise<[string, number]>((resolve, reject) => {
							const request = transaction.objectStore(name).count();
							request.onerror = () => reject(request.error);
							request.onsuccess = () => resolve([name, request.result]);
						}),
				),
			),
		);
	});
	expect(counts).toEqual({
		cards: PERF_FIXTURE.cardCount,
		cardContents: PERF_FIXTURE.cardCount,
		canvasRecords: PERF_FIXTURE.arrowCount,
		whiteboards: PERF_FIXTURE.childBoardCount + 1,
		changeLog: 10_000,
	});
});
