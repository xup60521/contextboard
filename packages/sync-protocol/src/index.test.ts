import { describe, expect, test, vi } from "vitest";
import {
	HybridLogicalClock,
	parseCheckpointDescriptor,
	parsePullChangesRequest,
	parseSyncVersionHeaders,
	syncVersionHeaders,
	SyncProtocolError,
} from "./index";

describe("HybridLogicalClock", () => {
	test("stays monotonic when wall time moves backwards", () => {
		const clock = new HybridLogicalClock("device-a");
		expect(clock.tick(200)).toBe("0000000000200:000000:device-a");
		expect(clock.tick(100)).toBe("0000000000200:000001:device-a");
	});

	test("validates shared request values at runtime", () => {
		expect(parseSyncVersionHeaders(syncVersionHeaders())).toEqual({
			protocolVersion: 1,
			schemaVersion: 2,
		});
		expect(() =>
			parsePullChangesRequest({
				workspaceId: "workspace",
				cursor: "01",
				limit: 1,
			}),
		).toThrow(SyncProtocolError);
		expect(() =>
			parseCheckpointDescriptor({
				checkpointId: "checkpoint",
				workspaceId: "workspace",
				coveredCursor: "1",
				blob: { hash: "not-a-hash", contentType: "text/plain", size: 1 },
				createdAt: 1,
			}),
		).toThrow("hash is invalid");
	});

	test("the local-only transport never attempts network access", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const { LocalOnlyTransport } = await import("./index");
		const transport = new LocalOnlyTransport();
		await expect(
			transport.pull({ workspaceId: "w", cursor: null, limit: 1 }),
		).rejects.toThrow("not configured");
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
