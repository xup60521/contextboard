import "fake-indexeddb/auto";
import {
	ContextboardDatabase,
	ensureLocalIdentity,
} from "@contextboard/local-db";
import type {
	BlobDescriptor,
	CheckpointDescriptor,
	WorkspaceCheckpoint,
} from "@contextboard/sync-protocol";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	bootstrapLatestCheckpoint,
	maybeCreateCheckpoint,
} from "./checkpoint";

const databases: ContextboardDatabase[] = [];
const makeDb = () => {
	const db = new ContextboardDatabase(
		`contextboard-checkpoint-${crypto.randomUUID()}`,
	);
	databases.push(db);
	return db;
};

afterEach(async () => {
	await Promise.all(databases.splice(0).map((db) => db.delete()));
});

async function descriptorFor(blob: Blob): Promise<BlobDescriptor> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		await blob.arrayBuffer(),
	);
	return {
		hash: [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
		contentType: blob.type,
		size: blob.size,
	};
}

describe("checkpoint lifecycle", () => {
	test("imports entities and covered cursor in one bootstrap transaction", async () => {
		const db = makeDb();
		await ensureLocalIdentity(db);
		const payload: WorkspaceCheckpoint = {
			workspaceId: "workspace-server",
			coveredCursor: "9",
			createdAt: 1,
			entities: {
				todos: [
					{
						id: "todo-1",
						text: "Checkpoint",
						completed: false,
						revision: 1,
						createdAt: 1,
						updatedAt: 1,
						updatedByDeviceId: "device-server",
						deletedAt: null,
					},
				],
			},
		};
		const blob = new Blob([gzipSync(strToU8(JSON.stringify(payload)))], {
			type: "application/gzip",
		});
		const checkpoint: CheckpointDescriptor = {
			checkpointId: "checkpoint-1",
			workspaceId: payload.workspaceId,
			coveredCursor: payload.coveredCursor,
			blob: await descriptorFor(blob),
			createdAt: 1,
		};
		const transport = {
			getLatestCheckpoint: vi.fn(async () => checkpoint),
			downloadBlob: vi.fn(async () => blob),
		};

		await expect(
			bootstrapLatestCheckpoint(
				db,
				transport as never,
				payload.workspaceId,
			),
		).resolves.toBe(true);
		expect(await db.todos.get("todo-1")).toMatchObject({
			text: "Checkpoint",
		});
		expect((await db.syncPeers.get("contextboard-cloud"))?.cursor).toBe("9");
	});

	test("falls back without advancing cursor for a corrupt checkpoint", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const blob = new Blob(["not gzip"], { type: "application/gzip" });
		const checkpoint: CheckpointDescriptor = {
			checkpointId: "checkpoint-corrupt",
			workspaceId: "workspace-server",
			coveredCursor: "12",
			blob: await descriptorFor(blob),
			createdAt: 1,
		};
		const transport = {
			getLatestCheckpoint: vi.fn(async () => checkpoint),
			downloadBlob: vi.fn(async () => blob),
		};

		await expect(
			bootstrapLatestCheckpoint(
				db,
				transport as never,
				checkpoint.workspaceId,
			),
		).resolves.toBe(false);
		expect((await db.settings.get("workspaceId"))?.value).toBe(
			identity.workspaceId,
		);
		expect(await db.syncPeers.get("contextboard-cloud")).toBeUndefined();
	});

	test("creates content-addressed checkpoints without binary or legacy snapshots", async () => {
		const db = makeDb();
		const identity = await ensureLocalIdentity(db);
		const now = Date.now();
		await db.settings.bulkPut([
			{ key: "checkpointChangeCount", value: 1_000 },
			{ key: "checkpointChangeBytes", value: 1 },
		]);
		await db.tldrawDocuments.put({
			id: "document-1",
			whiteboardId: "board-1",
			snapshot: { store: { secretSnapshotShape: { id: "shape:legacy" } } },
			revision: 1,
			createdAt: now,
			updatedAt: now,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		} as never);
		await db.files.put({
			id: "file-1",
			sha256: "a".repeat(64),
			contentType: "image/png",
			size: 3,
			status: "active",
			blob: new Blob(["raw"]),
			pendingDeleteAt: null,
			revision: 1,
			createdAt: now,
			updatedAt: now,
			updatedByDeviceId: identity.deviceId,
			deletedAt: null,
		} as never);
		let uploaded: Blob | null = null;
		const transport = {
			uploadBlob: vi.fn(
				async (
					_workspaceId: string,
					_descriptor: BlobDescriptor,
					blob: Blob,
				) => {
					uploaded = blob;
				},
			),
			registerCheckpoint: vi.fn(async () => undefined),
		};

		const result = await maybeCreateCheckpoint(
			db,
			transport as never,
			identity.workspaceId,
			"5",
		);
		expect(result?.blob.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(uploaded).not.toBeNull();
		const decoded = JSON.parse(
			strFromU8(
				gunzipSync(new Uint8Array(await (uploaded as Blob).arrayBuffer())),
			),
		) as WorkspaceCheckpoint;
		expect(decoded.entities.tldrawDocuments).toBeUndefined();
		expect(JSON.stringify(decoded)).not.toContain("secretSnapshotShape");
		expect(JSON.stringify(decoded)).not.toContain('"blob"');
		expect((await db.settings.get("checkpointChangeCount"))?.value).toBe(0);
		expect((await db.settings.get("checkpointChangeBytes"))?.value).toBe(0);
	});
});
