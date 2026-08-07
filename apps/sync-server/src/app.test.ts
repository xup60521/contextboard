import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
	syncVersionHeaders,
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

	test("allows only allowlisted desktop origins across origins", async () => {
		const root = mkdtempSync(join(tmpdir(), "contextboard-cors-"));
		roots.push(root);
		const store = new SyncStore(":memory:", join(root, "blobs"));
		const app = createSyncApp(store, undefined, {
			crossOriginAllowlist: ["tauri://localhost"],
		});

		// Preflight is answered before the sync version headers are demanded.
		const preflight = await app.request("/api/sync/v1/pull", {
			method: "OPTIONS",
			headers: {
				origin: "tauri://localhost",
				"access-control-request-method": "POST",
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-origin")).toBe(
			"tauri://localhost",
		);
		expect(preflight.headers.get("access-control-allow-headers")).toContain(
			"authorization",
		);
		// The desktop reads its bearer token off the one-time-token response.
		const authPreflight = await app.request("/api/auth/one-time-token/verify", {
			method: "OPTIONS",
			headers: {
				origin: "tauri://localhost",
				"access-control-request-method": "POST",
			},
		});
		expect(
			authPreflight.headers.get("access-control-expose-headers"),
		).toContain("set-auth-token");

		const foreign = await app.request("/api/sync/v1/health", {
			headers: { origin: "https://evil.example" },
		});
		expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
		store.close();
	});

	test("stays same-origin only when no desktop allowlist is configured", async () => {
		const { store, app } = createFixture();
		const response = await app.request("/api/sync/v1/health", {
			headers: { origin: "tauri://localhost" },
		});
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		store.close();
	});

	test("returns the precise protocol validation error for a legacy batch", async () => {
		const { store, app } = createFixture();
		const response = await app.request("/api/sync/v1/push", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...syncVersionHeaders(),
			},
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
			headers: {
				"content-type": "application/json",
				...syncVersionHeaders(),
			},
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

	test("filters cardContent for legacy clients and serves it to capable clients", async () => {
		const { store, app } = createFixture();
		const headers = {
			"content-type": "application/json",
			...syncVersionHeaders(),
		};
		const batch = {
			protocolVersion: SYNC_PROTOCOL_VERSION,
			schemaVersion: SYNC_SCHEMA_VERSION,
			changeId: "content-change",
			workspaceId: "workspace-1",
			deviceId: "device-1",
			deviceSequence: 1,
			clock: "0000000000001:000001:device-1",
			command: "cards.update",
			createdAt: 1,
			changes: [
				{
					entityType: "card",
					entityId: "card-1",
					baseRevision: null,
					revision: 1,
					operation: "upsert",
					clock: "0000000000001:000001:device-1",
					value: {
						id: "card-1",
						content: { type: "doc", content: [] },
						contentVersion: 1,
					},
				},
				{
					entityType: "cardContent",
					entityId: "card-1",
					baseRevision: null,
					revision: 1,
					operation: "upsert",
					clock: "0000000000001:000001:device-1",
					value: { id: "card-1", cardId: "card-1", document: null },
				},
			],
		};
		await app.request("/api/sync/v1/push", {
			method: "POST",
			headers,
			body: JSON.stringify({
				workspaceId: "workspace-1",
				cursor: null,
				capabilities: ["card-content-v1"],
				batches: [batch],
			}),
		});
		const pull = (capabilities?: string[]) =>
			app.request("/api/sync/v1/pull", {
				method: "POST",
				headers,
				body: JSON.stringify({
					workspaceId: "workspace-1",
					cursor: null,
					limit: 10,
					...(capabilities ? { capabilities } : {}),
				}),
			});
		const legacy = (await (await pull()).json()) as { batches: typeof batch[] };
		const capable = (await (await pull(["card-content-v1"])).json()) as {
			batches: typeof batch[];
		};
		expect(legacy.batches[0]?.changes).toEqual([
			expect.objectContaining({
				entityType: "card",
				value: expect.objectContaining({
					content: { type: "doc", content: [] },
				}),
			}),
		]);
		expect(capable.batches[0]?.changes.map((change) => change.entityType)).toEqual(
			["card", "cardContent"],
		);
		store.close();
	});

	test("rejects missing or unknown transport versions", async () => {
		const { store, app } = createFixture();
		const missing = await app.request("/api/sync/v1/pull", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				workspaceId: "workspace-1",
				cursor: null,
				limit: 1,
			}),
		});
		expect(missing.status).toBe(400);
		expect(await missing.json()).toEqual({
			error: "Unsupported protocol version: undefined",
		});

		const unknown = await app.request("/api/sync/v1/pull", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...syncVersionHeaders(),
				"x-contextboard-schema-version": "999",
			},
			body: JSON.stringify({
				workspaceId: "workspace-1",
				cursor: null,
				limit: 1,
			}),
		});
		expect(unknown.status).toBe(400);
		expect(await unknown.json()).toEqual({
			error: "Unsupported schema version: 999",
		});
		store.close();
	});

	test("validates cursor, identifiers, blob headers, and checkpoint bodies", async () => {
		const { store, app } = createFixture();
		const headers = {
			"content-type": "application/json",
			...syncVersionHeaders(),
		};
		const invalidCursor = await app.request("/api/sync/v1/pull", {
			method: "POST",
			headers,
			body: JSON.stringify({
				workspaceId: "workspace-1",
				cursor: "-1",
				limit: 1,
			}),
		});
		expect(invalidCursor.status).toBe(400);

		const invalidBlob = await app.request("/api/sync/v1/blobs/not-a-hash", {
			method: "PUT",
			headers: {
				...syncVersionHeaders(),
				"content-type": "application/octet-stream",
				"x-contextboard-workspace": "workspace-1",
				"x-contextboard-blob-size": "1",
			},
			body: "x",
		});
		expect(invalidBlob.status).toBe(400);

		const invalidCheckpoint = await app.request("/api/sync/v1/checkpoints", {
			method: "POST",
			headers,
			body: JSON.stringify({
				checkpointId: "checkpoint-1",
				workspaceId: "workspace-1",
				coveredCursor: "1",
				blob: {
					hash: "bad",
					contentType: "application/octet-stream",
					size: 1,
				},
				createdAt: 1,
			}),
		});
		expect(invalidCheckpoint.status).toBe(400);
		store.close();
	});
});
