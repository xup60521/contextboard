import {
	type ChangeBatch,
	SYNC_PROTOCOL_VERSION,
	SYNC_SCHEMA_VERSION,
	type SyncTransport,
} from "@contextboard/sync-protocol";
import { describe, expect, test } from "vitest";
import {
	HttpSyncTransport,
	SyncCoordinator,
	type WorkspaceRepository,
	workspaceChangeMatches,
} from "./index";

describe("workspaceChangeMatches", () => {
	test("does not deliver unscoped changes to board subscriptions", () => {
		expect(
			workspaceChangeMatches(
				{
					origin: "local",
					changes: [
						{
							entityType: "card",
							entityId: "card-1",
							operation: "upsert",
						},
					],
				},
				{ whiteboardIds: ["board-1"] },
			),
		).toBe(false);
	});

	test("scopes card content notifications by card id", () => {
		const change = {
			origin: "remote" as const,
			changes: [
				{
					entityType: "cardContent" as const,
					entityId: "content-1",
					operation: "upsert" as const,
					cardId: "card-1",
				},
			],
		};
		expect(workspaceChangeMatches(change, { cardIds: ["card-1"] })).toBe(true);
		expect(workspaceChangeMatches(change, { cardIds: ["card-2"] })).toBe(false);
	});
});

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
				lastAckAt: null,
			}),
			applyRemote: async (_batches, _peerId, cursor) => {
				applied.push(cursor);
				return { applied: 0, conflicts: 0 };
			},
			updateSyncCursor: async (_peerId, cursor) => {
				applied.push(cursor);
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

	test("advances an empty-pull cursor without applying a remote batch", async () => {
		let applyCalls = 0;
		const cursors: string[] = [];
		const repository: WorkspaceRepository = {
			query: async () => undefined as never,
			execute: async () => undefined as never,
			subscribe: () => () => undefined,
			getPendingBatches: async () => [],
			acknowledge: async () => undefined,
			getSyncState: async (peerId) => ({
				peerId,
				cursor: "4",
				enabled: true,
				updatedAt: 1,
				lastSyncedAt: null,
				lastAckAt: null,
			}),
			applyRemote: async () => {
				applyCalls += 1;
				return { applied: 0, conflicts: 0 };
			},
			updateSyncCursor: async (_peerId, cursor) => {
				cursors.push(cursor);
			},
		};
		const transport: SyncTransport = {
			push: async () => ({
				cursor: "ignored-push-cursor",
				acknowledgedChangeIds: [],
				missingBlobHashes: [],
			}),
			pull: async () => ({ cursor: "5", batches: [], hasMore: false }),
		};

		await new SyncCoordinator("workspace-1", repository, transport).syncNow();

		expect(applyCalls).toBe(0);
		expect(cursors).toEqual(["5"]);
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
				lastAckAt: null,
			}),
			applyRemote: async () => ({ applied: 0, conflicts: 0 }),
			updateSyncCursor: async () => undefined,
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

	test("stop aborts an in-flight request without reporting a sync error", async () => {
		const repository: WorkspaceRepository = {
			query: async () => undefined as never,
			execute: async () => undefined as never,
			subscribe: () => () => undefined,
			getPendingBatches: async () => [],
			acknowledge: async () => undefined,
			getSyncState: async (peerId) => ({
				peerId,
				cursor: null,
				enabled: true,
				updatedAt: 1,
				lastSyncedAt: null,
				lastAckAt: null,
			}),
			applyRemote: async () => ({ applied: 0, conflicts: 0 }),
			updateSyncCursor: async () => undefined,
		};
		let requestStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		const transport: SyncTransport = {
			push: async () => ({
				cursor: "0",
				acknowledgedChangeIds: [],
				missingBlobHashes: [],
			}),
			pull: async (_request, signal) => {
				requestStarted();
				return await new Promise<never>((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				});
			},
		};
		const coordinator = new SyncCoordinator(
			"workspace-1",
			repository,
			transport,
		);
		const syncing = coordinator.syncNow();
		await started;
		coordinator.stop();
		await expect(syncing).resolves.toBeUndefined();
		expect(coordinator.status.state).toBe("local-only");
	});
});

describe("HttpSyncTransport", () => {
	function captureFetch() {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(JSON.stringify({ workspaces: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof globalThis.fetch;
		return { calls, restore: () => (globalThis.fetch = original) };
	}

	test("sends cookies same-origin but omits them for a bearer client", async () => {
		const { calls, restore } = captureFetch();
		try {
			await new HttpSyncTransport().listWorkspaces();
			// A cross-origin credentialed request needs
			// Access-Control-Allow-Credentials, which a bearer-only server does not
			// send, so the browser would block the response outright.
			await new HttpSyncTransport({
				baseURL: "http://localhost:3000",
				credentials: "omit",
				getAuthHeaders: () => ({ authorization: "Bearer token-1" }),
			}).listWorkspaces();

			expect(calls[0]?.init.credentials).toBe("include");
			expect(calls[1]?.init.credentials).toBe("omit");
			expect(calls[1]?.url).toBe(
				"http://localhost:3000/api/sync/v1/workspaces",
			);
			expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe(
				"Bearer token-1",
			);
		} finally {
			restore();
		}
	});

	test("applies the credentials mode to blob downloads too", async () => {
		const { calls, restore } = captureFetch();
		try {
			await new HttpSyncTransport({
				baseURL: "http://localhost:3000",
				credentials: "omit",
				getAuthHeaders: () => ({ authorization: "Bearer token-1" }),
			}).downloadBlob("workspace-1", {
				hash: "a".repeat(64),
				contentType: "image/png",
				size: 1,
			});
			expect(calls[0]?.init.credentials).toBe("omit");
			expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
				"Bearer token-1",
			);
		} finally {
			restore();
		}
	});

	test("preserves workspace redirect details from the server", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					error: "Workspace has been merged",
					redirectWorkspaceId: "canonical-workspace",
				}),
				{ status: 410, headers: { "content-type": "application/json" } },
			)) as typeof globalThis.fetch;
		try {
			await expect(
				new HttpSyncTransport().pull({
					workspaceId: "old-workspace",
					cursor: null,
					limit: 10,
				}),
			).rejects.toMatchObject({
				status: 410,
				redirectWorkspaceId: "canonical-workspace",
			});
		} finally {
			globalThis.fetch = original;
		}
	});
});
