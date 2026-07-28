// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { useCallback, useEffect } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	type Listener = (status: {
		state: "local-only" | "idle" | "syncing" | "error";
		cursor: string | null;
	}) => void;
	class Coordinator {
		static instance: Coordinator | null = null;
		status = { state: "idle" as const, cursor: null };
		listener: Listener | null = null;
		constructor() {
			Coordinator.instance = this;
		}
		subscribe(listener: Listener) {
			this.listener = listener;
			listener(this.status);
			return () => {
				this.listener = null;
			};
		}
		async syncNow() {
			this.emit("syncing");
			await Promise.resolve();
			this.emit("idle");
		}
		stop() {
			this.emit("local-only");
		}
		retryDelay() {
			return 1_000;
		}
		emit(state: "local-only" | "idle" | "syncing" | "error") {
			this.status = { state: state as "idle", cursor: null };
			this.listener?.(this.status);
		}
	}
	return {
		Coordinator,
		session: {
			data: { user: { id: "user-1" } },
			isPending: false,
			refetch: vi.fn(async () => undefined),
		},
	};
});

vi.mock("@contextboard/auth-client", () => ({
	useSession: () => mocks.session,
}));

vi.mock("@contextboard/client-core", () => ({
	HttpSyncError: class HttpSyncError extends Error {
		constructor(readonly status: number, message: string) {
			super(message);
		}
	},
	HttpSyncTransport: class HttpSyncTransport {
		async listWorkspaces() {
			return {
				workspaces: [
					{ workspaceId: "workspace-1", role: "owner", createdAt: 1 },
				],
			};
		}
	},
	SyncCoordinator: mocks.Coordinator,
}));

vi.mock("@contextboard/local-db", () => ({
	acknowledgeBatches: vi.fn(),
	adoptWorkspaceId: vi.fn(),
	applyRemoteBatches: vi.fn(),
	getLocalBlob: vi.fn(),
	getMissingBlobs: vi.fn(async () => []),
	getPendingBatches: vi.fn(async () => []),
	getSyncState: vi.fn(async () => ({
		peerId: "contextboard-cloud",
		cursor: null,
		enabled: true,
		updatedAt: 1,
		lastSyncedAt: null,
	})),
	hasWorkspaceData: vi.fn(async () => false),
	storeRemoteBlob: vi.fn(),
}));

vi.mock("./checkpoint", () => ({
	bootstrapLatestCheckpoint: vi.fn(async () => false),
	maybeCreateCheckpoint: vi.fn(async () => null),
}));

import { useWhiteboardAssetStore } from "../../components/whiteboard/hooks/useWhiteboardAssetStore";
import { LocalDatabaseContext } from "../local/provider";
import { useMutation } from "../local/react";
import { SyncProvider } from "./provider";

afterEach(() => {
	mocks.Coordinator.instance = null;
	vi.clearAllMocks();
});

describe("SyncProvider render isolation", () => {
	test("sync status changes keep whiteboard mutation and resource identities stable", async () => {
		const mutationIdentities: unknown[] = [];
		const assetStoreIdentities: unknown[] = [];
		let renderCount = 0;
		let mountCount = 0;
		let listenerSubscriptions = 0;
		let listenerCleanups = 0;

		function CanvasStabilityProbe() {
			renderCount += 1;
			const applyChanges = useMutation("canvas.applyRecordChanges");
			const generateUploadUrl = useMutation("files.generateUploadUrl");
			const finalizeUpload = useMutation("files.finalizeUpload");
			const assetStore = useWhiteboardAssetStore({
				generateUploadUrl: generateUploadUrl as () => Promise<string>,
				finalizeUpload: finalizeUpload as never,
			});
			const onMount = useCallback(() => {
				mountCount += 1;
			}, [assetStore]);

			mutationIdentities.push(applyChanges);
			assetStoreIdentities.push(assetStore);
			useEffect(() => {
				onMount();
			}, [onMount]);
			useEffect(() => {
				listenerSubscriptions += 1;
				return () => {
					listenerCleanups += 1;
				};
			}, [applyChanges]);
			return <div data-testid="canvas">ready</div>;
		}

		const database = {
			changeLog: { count: vi.fn(async () => 0) },
			conflicts: { toArray: vi.fn(async () => []) },
		};
		const local = {
			status: "ready",
			database,
			workspaceId: "workspace-1",
			deviceId: "device-1",
			error: null,
			updateWorkspaceIdentity: vi.fn(),
		};

		const view = render(
			<LocalDatabaseContext.Provider value={local as never}>
				<SyncProvider>
					<CanvasStabilityProbe />
				</SyncProvider>
			</LocalDatabaseContext.Provider>,
		);

		await waitFor(() => expect(mocks.Coordinator.instance).not.toBeNull());
		await act(async () => {
			await Promise.resolve();
		});
		const settledRenderCount = renderCount;

		act(() => {
			mocks.Coordinator.instance?.emit("syncing");
			mocks.Coordinator.instance?.emit("idle");
		});

		expect(renderCount).toBe(settledRenderCount);
		expect(new Set(mutationIdentities).size).toBe(1);
		expect(new Set(assetStoreIdentities).size).toBe(1);
		expect(mountCount).toBe(1);
		expect(listenerSubscriptions).toBe(1);
		expect(listenerCleanups).toBe(0);
		expect(view.queryByText("Loading whiteboard...")).toBeNull();
	});
});
