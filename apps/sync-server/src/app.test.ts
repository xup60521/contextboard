import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { createSyncApp } from "./app";
import { SyncStore } from "./store";

const roots: string[] = [];
const createFixture = () => {
	const root = mkdtempSync(join(tmpdir(), "contextboard-hono-"));
	roots.push(root);
	const store = new SyncStore(":memory:", join(root, "blobs"));
	return { store, app: createSyncApp(store) };
};

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("Hono sync app", () => {
	test("serves health and popup completion without the auth router", async () => {
		const { store, app } = createFixture();
		expect(await (await app.request("/api/sync/v1/health")).json()).toEqual({
			ok: true,
		});
		const popup = await app.request("/api/auth/popup-complete");
		expect(popup.status).toBe(200);
		expect(await popup.text()).toContain("contextboard:auth-popup-complete");
		store.close();
	});

	test("returns the precise protocol validation error for a legacy batch", async () => {
		const { store, app } = createFixture();
		const response = await app.request("/api/sync/v1/push", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				workspaceId: "workspace-1",
				cursor: null,
				batches: [
					{
						protocolVersion: SYNC_PROTOCOL_VERSION,
						schemaVersion: undefined,
						changeId: "legacy",
						workspaceId: "workspace-1",
						deviceId: "device-1",
						deviceSequence: 1,
						clock: "0000000000001:000001:device-1",
						command: "todos.add",
						createdAt: 1,
						changes: [],
					},
				],
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: `Unsupported schema version: undefined`,
		});
		expect(response.headers.get("cache-control")).toBe("no-store");
		store.close();
	});

	test("accepts a valid batch through Hono routing", async () => {
		const { store, app } = createFixture();
		const response = await app.request("/api/sync/v1/push", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				workspaceId: "workspace-1",
				cursor: null,
				batches: [
					{
						protocolVersion: SYNC_PROTOCOL_VERSION,
						schemaVersion: SYNC_SCHEMA_VERSION,
						changeId: "change-1",
						workspaceId: "workspace-1",
						deviceId: "device-1",
						deviceSequence: 1,
						clock: "0000000000001:000001:device-1",
						command: "todos.add",
						createdAt: 1,
						changes: [],
					},
				],
			}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			acknowledgedChangeIds: ["change-1"],
		});
		store.close();
	});
});
