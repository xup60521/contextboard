import { describe, expect, test, vi } from "vitest";
import mergeConformance from "./merge-conformance.json" with { type: "json" };
import {
	conflictCopyCardId,
	deterministicEntityId,
	HybridLogicalClock,
	parseChangeBatch,
	parseCheckpointDescriptor,
	parsePullChangesRequest,
	parseSyncVersionHeaders,
	syncVersionHeaders,
	SyncProtocolError,
} from "./index";

describe("HybridLogicalClock", () => {
	test("consumes the shared TypeScript/Rust merge conformance fixtures", () => {
		for (const fixture of mergeConformance.deterministicIds) {
			const actual =
				fixture.kind === "conflictCopyCard"
					? conflictCopyCardId(fixture.parts[0]!)
					: deterministicEntityId(fixture.namespace!, ...fixture.parts);
			expect(actual).toBe(fixture.expected);
		}
		expect(mergeConformance.scenarios.map((scenario) => scenario.name)).toEqual([
			"equal clocks",
			"stale clocks",
			"revision conflicts",
			"hierarchy conflicts",
			"duplicate batches",
			"tombstones",
			"file normalization",
			"conflict-copy determinism",
		]);
	});
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

	test("creates compact deterministic IDs for conflict-derived entities", () => {
		const conflictId = `conflict:${"card-id:".repeat(20)}device-a:42:device-b:57`;
		const cardId = conflictCopyCardId(conflictId);
		expect(cardId).toBe(conflictCopyCardId(conflictId));
		expect(cardId).not.toBe(conflictCopyCardId(`${conflictId}:other`));
		expect(
			deterministicEntityId("conflict-placement", conflictId, "placement-id"),
		).toHaveLength("conflict-placement:".length + 32);
		expect(() =>
			parseChangeBatch({
				protocolVersion: 1,
				schemaVersion: 2,
				changeId: "change",
				workspaceId: "workspace",
				deviceId: "device",
				deviceSequence: 1,
				clock: "0000000000001:000000:device",
				command: "conflicts.resolve",
				createdAt: 1,
				changes: [
					{
						entityType: "card",
						entityId: cardId,
						baseRevision: null,
						revision: 1,
						operation: "upsert",
						clock: "0000000000001:000000:device",
						value: {},
					},
				],
			}),
		).not.toThrow();
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
