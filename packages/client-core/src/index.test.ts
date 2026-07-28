import {
	type ChangeBatch,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
	type SyncTransport,
} from "@contextboard/sync-protocol";
import { describe, expect, test } from "vitest";
import { SyncCoordinator, type WorkspaceRepository } from "./index";

const batch: ChangeBatch = {
	protocolVersion: SYNC_PROTOCOL_VERSION,
	schemaVersion: SYNC_SCHEMA_VERSION,
	changeId: "change-1",
	workspaceId: "workspace-1",
	deviceId: "device-1",
	deviceSequence: 1,
	clock: "0000000000001:000001:device-1",
	command: "cards.create",
	createdAt: 1,
	changes: [],
};

describe("SyncCoordinator", () => {
	test("does not advance the pull cursor from a push response", async () => {
		const pullCursors: Array<string | null> = [];
		const applied: string[] = [];
		const repository: WorkspaceRepository = {
			query: async () => undefined as never,
			execute: async () => undefined as never,
			subscribe: () => () => undefined,
			getPendingBatches: async () => [batch],
			acknowledge: async () => undefined,
			getSyncState: async (peerId) => ({
				peerId,
				cursor: "5",
				enabled: true,
				updatedAt: 1,
				lastSyncedAt: null,
			}),
			applyRemote: async (_batches, _peerId, cursor) => {
				applied.push(cursor);
				return { applied: 0, conflicts: 0 };
			},
		};
		const transport: SyncTransport = {
			push: async () => ({
				cursor: "10",
				acknowledgedChangeIds: ["change-1"],
				missingBlobHashes: [],
			}),
			pull: async (request) => {
				pullCursors.push(request.cursor);
				return { cursor: "8", batches: [], hasMore: false };
			},
		};
		await new SyncCoordinator("workspace-1", repository, transport).syncNow();
		expect(pullCursors).toEqual(["5"]);
		expect(applied).toEqual(["8"]);
	});

	test("keeps a pending batch until required blob uploads succeed", async () => {
		let acknowledged = false;
		const repository: WorkspaceRepository = {
			query: async () => undefined as never,
			execute: async () => undefined as never,
			subscribe: () => () => undefined,
			getPendingBatches: async () => [batch],
			acknowledge: async () => {
				acknowledged = true;
			},
			getSyncState: async (peerId) => ({
				peerId,
				cursor: null,
				enabled: true,
				updatedAt: 1,
				lastSyncedAt: null,
			}),
			applyRemote: async () => ({ applied: 0, conflicts: 0 }),
			getLocalBlob: async () => ({
				descriptor: {
					hash: "a".repeat(64),
					contentType: "text/plain",
					size: 1,
				},
				blob: new Blob(["a"]),
			}),
		};
		const transport: SyncTransport = {
			push: async () => ({
				cursor: "1",
				acknowledgedChangeIds: ["change-1"],
				missingBlobHashes: ["a".repeat(64)],
			}),
			pull: async () => ({ cursor: "0", batches: [], hasMore: false }),
			uploadBlob: async () => {
				throw new Error("interrupted");
			},
		};
		await expect(
			new SyncCoordinator("workspace-1", repository, transport).syncNow(),
		).rejects.toThrow("interrupted");
		expect(acknowledged).toBe(false);
	});
});
