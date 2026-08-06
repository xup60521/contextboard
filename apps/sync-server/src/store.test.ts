import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ChangeBatch,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
} from "@contextboard/sync-protocol";
import { hashDeviceCode } from "./device-codes";
import { SyncStore } from "./store";

const roots: string[] = [];
const createStore = () => {
	const root = mkdtempSync(join(tmpdir(), "contextboard-sync-"));
	roots.push(root);
	return new SyncStore(":memory:", join(root, "blobs"));
};
const sha256 = (bytes: Uint8Array) =>
	new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
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
	test("device authorization can be approved only once", () => {
		const store = createStore();
		const created = store.createDeviceCode({
			clientName: "contextboard-cli",
			deviceName: "test-box",
		});
		expect(
			store.decideDeviceCode(
				created.userCode,
				"user-1",
				"one@example.com",
				"approve",
				1_000,
			),
		).toBe(true);
		expect(
			store.decideDeviceCode(
				created.userCode,
				"user-2",
				"two@example.com",
				"deny",
				1_001,
			),
		).toBe(false);
		store.close();
	});

	test("slows down early polls and expires a replayed approval", () => {
		const store = createStore();
		const pending = store.createDeviceCode({
			clientName: "contextboard-cli",
			intervalSeconds: 5,
		});
		expect(store.pollDeviceCode(pending.deviceCode, 1_000).status).toBe("pending");
		const slowed = store.pollDeviceCode(pending.deviceCode, 1_001);
		expect(slowed).toEqual({ status: "slow_down", intervalSeconds: 10 });

		const approved = store.createDeviceCode({
			clientName: "contextboard-cli",
			deviceName: "replay-box",
		});
		store.decideDeviceCode(
			approved.userCode,
			"user-1",
			"one@example.com",
			"approve",
			10_000,
		);
		const first = store.pollDeviceCode(approved.deviceCode, 10_000);
		expect(first.status).toBe("approved");
		expect(store.pollDeviceCode(approved.deviceCode, 20_000)).toEqual({
			status: "expired",
		});
		store.close();
	});

	test("uses injected time for expiry and enforces the poll ceiling", () => {
		const store = createStore();
		const expired = store.createDeviceCode({ clientName: "contextboard-cli", ttlMs: 100 });
		expect(store.pollDeviceCode(expired.deviceCode, expired.expiresAt)).toEqual({
			status: "expired",
		});

		const ceiling = store.createDeviceCode({ clientName: "contextboard-cli" });
		store.db
			.prepare("UPDATE device_codes SET poll_count = ? WHERE device_code_hash = ?")
			.run(200, hashDeviceCode(ceiling.deviceCode));
		expect(store.pollDeviceCode(ceiling.deviceCode, Date.now())).toEqual({
			status: "expired",
		});
		store.close();
	});

	test("mints a listed ordinary agent token with the device name", () => {
		const store = createStore();
		const created = store.createDeviceCode({
			clientName: "contextboard-cli",
			deviceName: "macbook-pro",
		});
		store.decideDeviceCode(
			created.userCode,
			"user-1",
			"one@example.com",
			"approve",
			1_000,
		);
		const result = store.pollDeviceCode(created.deviceCode, 1_000);
		expect(result.status).toBe("approved");
		if (result.status !== "approved") return;
		expect(result.token).toStartWith("cbat_");
		expect(store.listAgentTokens("user-1")[0]?.name).toBe(
			"contextboard-cli (macbook-pro)",
		);
		store.close();
	});
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
		expect(store.listWorkspaces("user-1").workspaces).toHaveLength(1);
		expect(store.listWorkspaces("user-1").workspaces[0]?.isDefault).toBe(true);
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
		expect(store.getBlobDescriptor("workspace-1", "0".repeat(64))).toBeNull();
		expect(readdirSync(join(store.blobRoot, "workspace-1"))).toHaveLength(0);
		store.close();
	});

	test("stores blobs idempotently and isolates identical hashes by workspace", async () => {
		const store = createStore();
		const bytes = new TextEncoder().encode("content-addressed");
		const descriptor = {
			hash: sha256(bytes),
			contentType: "text/plain",
			size: bytes.length,
		};
		await store.putBlob("workspace-1", descriptor, new Blob([bytes]).stream());
		await store.putBlob("workspace-1", descriptor, new Blob([bytes]).stream());
		expect(store.getBlobDescriptor("workspace-1", descriptor.hash)).toEqual(
			descriptor,
		);
		expect(store.getBlobDescriptor("workspace-2", descriptor.hash)).toBeNull();

		await store.putBlob("workspace-2", descriptor, new Blob([bytes]).stream());
		expect(store.getBlobDescriptor("workspace-2", descriptor.hash)).toEqual(
			descriptor,
		);
		expect(store.blobPath("workspace-1", descriptor.hash)).not.toBe(
			store.blobPath("workspace-2", descriptor.hash),
		);
		store.close();
	});

	test("assigns the oldest membership as default and supports explicit selection", () => {
		const store = createStore();
		store.claimWorkspace("workspace-old", "device-1", "user-1");
		store.claimWorkspace("workspace-new", "device-2", "user-1");
		let listing = store.listWorkspaces("user-1");
		expect(
			Object.fromEntries(
				listing.workspaces.map((item) => [item.workspaceId, item.isDefault]),
			),
		).toEqual({ "workspace-old": true, "workspace-new": false });
		store.selectDefaultWorkspace("workspace-new", "user-1");
		listing = store.listWorkspaces("user-1");
		expect(
			listing.workspaces.find((item) => item.workspaceId === "workspace-new")
				?.isDefault,
		).toBe(true);
		store.close();
	});

	test("merges source history and blobs into the target without deleting the source", async () => {
		const store = createStore();
		store.claimWorkspace("target", "target-device", "user-1");
		store.claimWorkspace("source", "source-device", "user-1");
		const targetBatch = {
			...batch(1, "target-change"),
			workspaceId: "target",
			deviceId: "target-device",
		};
		const sourceBatch = {
			...batch(1, "source-change"),
			workspaceId: "source",
			deviceId: "source-device",
		};
		store.push("target", [targetBatch]);
		store.push("source", [sourceBatch]);
		const bytes = new TextEncoder().encode("source blob");
		const descriptor = {
			hash: sha256(bytes),
			contentType: "text/plain",
			size: bytes.length,
		};
		await store.putBlob("source", descriptor, new Blob([bytes]).stream());

		const report = store.mergeWorkspaces("source", "target");
		expect(report).toMatchObject({ applied: true, batches: 1, blobs: 1 });
		const pulled = store.pull("target", null, 10);
		expect(pulled.batches.map((item) => item.changeId)).toEqual([
			"target-change",
			"source-change",
		]);
		expect(pulled.batches[1]?.workspaceId).toBe("target");
		expect(store.getBlobDescriptor("target", descriptor.hash)).toEqual(
			descriptor,
		);
		expect(
			store.listWorkspaces("user-1").workspaces.map((item) => item.workspaceId),
		).toEqual(["target"]);
		expect(store.listWorkspaces("user-1").redirects).toHaveLength(1);
		expect(store.getWorkspaceRedirect("source", "user-1")?.toWorkspaceId).toBe(
			"target",
		);
		store.close();
	});

	test("aborts a merge on a target device-sequence collision", () => {
		const store = createStore();
		store.claimWorkspace("target", "device-1", "user-1");
		store.claimWorkspace("source", "source-device", "user-1");
		store.push("target", [
			{ ...batch(1, "target-change"), workspaceId: "target" },
		]);
		store.push("source", [
			{ ...batch(1, "source-change"), workspaceId: "source" },
		]);
		expect(() => store.mergeWorkspaces("source", "target")).toThrow(
			"Device sequence collision",
		);
		expect(store.listWorkspaces("user-1").redirects).toHaveLength(0);
		store.close();
	});

	test("an interrupted upload leaves neither a completed record nor temp file", async () => {
		const store = createStore();
		const bytes = new TextEncoder().encode("partial");
		const descriptor = {
			hash: sha256(bytes),
			contentType: "application/octet-stream",
			size: bytes.length,
		};
		const interrupted = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, 2));
				controller.error(new Error("connection lost"));
			},
		});
		await expect(
			store.putBlob("workspace-1", descriptor, interrupted),
		).rejects.toThrow("connection lost");
		expect(store.getBlobDescriptor("workspace-1", descriptor.hash)).toBeNull();
		expect(readdirSync(join(store.blobRoot, "workspace-1"))).toHaveLength(0);
		store.close();
	});
});
