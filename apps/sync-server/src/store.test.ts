import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ChangeBatch,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { SyncStore } from "./store";

const roots: string[] = [];
const createStore = () => {
	const root = mkdtempSync(join(tmpdir(), "contextboard-sync-"));
	roots.push(root);
	return new SyncStore(":memory:", join(root, "blobs"));
};
const batch = (
	sequence: number,
	changeId = `change-${sequence}`,
): ChangeBatch => ({
	protocolVersion: SYNC_PROTOCOL_VERSION,
	schemaVersion: SYNC_SCHEMA_VERSION,
	changeId,
	workspaceId: "workspace-1",
	deviceId: "device-1",
	deviceSequence: sequence,
	clock: `0000000000001:00000${sequence}:device-1`,
	command: "cards.updateContent",
	createdAt: sequence,
	changes: [
		{
			entityType: "card",
			entityId: "card-1",
			baseRevision: sequence - 1 || null,
			revision: sequence,
			operation: "upsert",
			clock: `0000000000001:00000${sequence}:device-1`,
			value: { id: "card-1", revision: sequence, content: { type: "doc" } },
		},
	],
});

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("SyncStore", () => {
	test("deduplicates retries by change id and device sequence", () => {
		const store = createStore();
		const first = store.push("workspace-1", [batch(1)]);
		const retry = store.push("workspace-1", [batch(1)]);
		expect(retry.acknowledgedChangeIds).toEqual(["change-1"]);
		expect(retry.cursor).toBe(first.cursor);
		expect(store.pull("workspace-1", null, 10).batches).toHaveLength(1);
		store.close();
	});

	test("retains append order while accepting out-of-order device sequences", () => {
		const store = createStore();
		store.push("workspace-1", [batch(2), batch(1)]);
		const pulled = store.pull("workspace-1", null, 1);
		expect(pulled.batches[0]?.deviceSequence).toBe(2);
		expect(pulled.hasMore).toBe(true);
		const remainder = store.pull("workspace-1", pulled.cursor, 10);
		expect(remainder.batches[0]?.deviceSequence).toBe(1);
		store.close();
	});

	test("rejects a device sequence collision with a different change id", () => {
		const store = createStore();
		store.push("workspace-1", [batch(1, "first")]);
		expect(() => store.push("workspace-1", [batch(1, "different")])).toThrow(
			"Device sequence",
		);
		expect(store.pull("workspace-1", null, 10).batches).toHaveLength(1);
		store.close();
	});

	test("claims a new workspace atomically and idempotently", () => {
		const store = createStore();
		const claimed = store.claimWorkspace("workspace-1", "device-1", "user-1");
		expect(claimed.claimed).toBe(true);
		expect(claimed.role).toBe("owner");
		const retry = store.claimWorkspace("workspace-1", "device-1", "user-1");
		expect(retry.claimed).toBe(false);
		expect(store.listWorkspaces("user-1")).toHaveLength(1);
		expect(() =>
			store.claimWorkspace("workspace-1", "device-2", "user-2"),
		).toThrow("another account");
		store.close();
	});

	test("rejects a blob whose bytes do not match its descriptor", async () => {
		const store = createStore();
		const bytes = new TextEncoder().encode("actual");
		await expect(
			store.putBlob(
				"workspace-1",
				{ hash: "0".repeat(64), contentType: "text/plain", size: bytes.length },
				new Blob([bytes]).stream(),
			),
		).rejects.toThrow("hash or size mismatch");
		store.close();
	});
});
