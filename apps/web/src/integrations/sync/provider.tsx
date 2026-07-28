import { useSession } from "@contextboard/auth-client";
import {
	HttpSyncTransport,
	SyncCoordinator,
	type WorkspaceRepository,
} from "@contextboard/client-core";
import {
	acknowledgeBatches,
	adoptWorkspaceId,
	applyRemoteBatches,
	getLocalBlob,
	getMissingBlobs,
	getPendingBatches,
	getSyncState,
	hasWorkspaceData,
	storeRemoteBlob,
} from "@contextboard/local-db";
import type { SyncStatus } from "@contextboard/sync-protocol";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocalDatabase } from "../local/provider";
import { bootstrapLatestCheckpoint, maybeCreateCheckpoint } from "./checkpoint";

export type SyncUiState = SyncStatus & {
	workspaceId: string | null;
	pendingCount: number;
	conflictCount: number;
	lastSyncedAt: number | null;
};

type SyncRuntime = {
	state: SyncUiState;
	signedIn: boolean;
	sessionPending: boolean;
};

type SyncActions = {
	syncNow: () => Promise<void>;
	notifyLocalChange: () => void;
};

const initialState: SyncUiState = {
	state: "local-only",
	cursor: null,
	workspaceId: null,
	pendingCount: 0,
	conflictCount: 0,
	lastSyncedAt: null,
};

const SyncRuntimeContext = createContext<SyncRuntime | null>(null);
const SyncActionsContext = createContext<SyncActions | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
	const local = useLocalDatabase();
	const session = useSession();
	const userId = session.data?.user.id ?? null;
	const [state, setState] = useState(initialState);
	const coordinatorRef = useRef<SyncCoordinator | null>(null);
	const checkpointRef = useRef<{
		transport: HttpSyncTransport;
		workspaceId: string;
	} | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refreshCounts = useCallback(async () => {
		if (local.status !== "ready") return;
		const [pendingCount, conflictCount] = await Promise.all([
			local.database.changeLog.count(),
			local.database.conflicts
				.toArray()
				.then((rows) => rows.filter((row) => row.resolvedAt === null).length),
		]);
		setState((current) => ({ ...current, pendingCount, conflictCount }));
	}, [local]);

	const syncNow = useCallback(async () => {
		const coordinator = coordinatorRef.current;
		if (!coordinator) return;
		try {
			await coordinator.syncNow();
			const checkpoint = checkpointRef.current;
			if (checkpoint && local.status === "ready")
				await maybeCreateCheckpoint(
					local.database,
					checkpoint.transport,
					checkpoint.workspaceId,
					coordinator.status.cursor,
				);
		} finally {
			await refreshCounts();
		}
	}, [refreshCounts, local.database, local.status]);

	const notifyLocalChange = useCallback(() => {
		void refreshCounts();
		if (!coordinatorRef.current) return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => void syncNow(), 500);
	}, [refreshCounts, syncNow]);

	useEffect(() => {
		if (local.status !== "ready") return;
		void refreshCounts();
		if (!userId) {
			coordinatorRef.current = null;
			setState((current) => ({
				...current,
				state: "local-only",
				workspaceId: local.workspaceId,
			}));
			return;
		}

		let active = true;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const transport = new HttpSyncTransport();
		const start = async () => {
			setState((current) => ({
				...current,
				state: "syncing",
				workspaceId: local.workspaceId,
			}));
			const listing = await transport.listWorkspaces();
			const currentMembership = listing.workspaces.find(
				(item) => item.workspaceId === local.workspaceId,
			);
			let workspaceId = local.workspaceId;
			if (!currentMembership) {
				const hasData = await hasWorkspaceData(local.database);
				if (!hasData && listing.workspaces[0]) {
					workspaceId = listing.workspaces[0].workspaceId;
					await adoptWorkspaceId(local.database, workspaceId);
					await bootstrapLatestCheckpoint(
						local.database,
						transport,
						workspaceId,
					);
				} else {
					await transport.claimWorkspace({
						workspaceId,
						deviceId: local.deviceId,
					});
				}
			}
			if (!active) return;
			const repository: WorkspaceRepository = {
				query: async () => {
					throw new Error("Domain queries are provided by the Web adapter");
				},
				execute: async () => {
					throw new Error("Domain commands are provided by the Web adapter");
				},
				subscribe: () => () => undefined,
				getPendingBatches: (limit) => getPendingBatches(local.database, limit),
				acknowledge: (ids) => acknowledgeBatches(local.database, ids),
				applyRemote: (batches, peerId, cursor) =>
					applyRemoteBatches(local.database, batches, peerId, cursor),
				getSyncState: (peerId) => getSyncState(local.database, peerId),
				getLocalBlob: (hash) => getLocalBlob(local.database, hash),
				getMissingBlobs: () => getMissingBlobs(local.database),
				storeRemoteBlob: (descriptor, blob) =>
					storeRemoteBlob(local.database, descriptor, blob),
			};
			const coordinator = new SyncCoordinator(
				workspaceId,
				repository,
				transport,
			);
			coordinatorRef.current = coordinator;
			checkpointRef.current = { transport, workspaceId };
			coordinator.subscribe((next) => {
				if (!active) return;
				setState((current) => ({
					...current,
					...next,
					workspaceId,
					lastSyncedAt:
						next.state === "idle" ? Date.now() : current.lastSyncedAt,
				}));
			});
			await syncNow().catch(() => undefined);

			const schedulePull = () => {
				const delay =
					coordinator.status.state === "error"
						? coordinator.retryDelay()
						: typeof document !== "undefined" && document.hidden
							? 30_000
							: 2_000;
				const timer = setTimeout(async () => {
					timers.delete(timer);
					await syncNow().catch(() => undefined);
					if (active) schedulePull();
				}, delay);
				timers.add(timer);
			};
			schedulePull();
		};
		void start().catch((error) => {
			if (!active) return;
			setState((current) => ({
				...current,
				state: "error",
				error: error instanceof Error ? error.message : String(error),
			}));
		});

		const immediate = () => void syncNow().catch(() => undefined);
		const flush = () =>
			void coordinatorRef.current?.syncNow().catch(() => undefined);
		window.addEventListener("focus", immediate);
		window.addEventListener("online", immediate);
		window.addEventListener("pagehide", flush);
		return () => {
			active = false;
			coordinatorRef.current = null;
			checkpointRef.current = null;
			for (const timer of timers) clearTimeout(timer);
			window.removeEventListener("focus", immediate);
			window.removeEventListener("online", immediate);
			window.removeEventListener("pagehide", flush);
		};
	}, [local, refreshCounts, syncNow, userId]);

	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		},
		[],
	);

	const runtimeValue = useMemo<SyncRuntime>(
		() => ({
			state,
			signedIn: Boolean(userId),
			sessionPending: session.isPending,
		}),
		[session.isPending, state, userId],
	);
	const actionsValue = useMemo<SyncActions>(
		() => ({ syncNow, notifyLocalChange }),
		[notifyLocalChange, syncNow],
	);
	return (
		<SyncActionsContext.Provider value={actionsValue}>
			<SyncRuntimeContext.Provider value={runtimeValue}>
				{children}
			</SyncRuntimeContext.Provider>
		</SyncActionsContext.Provider>
	);
}

export function useSyncRuntime() {
	const runtime = useContext(SyncRuntimeContext);
	const actions = useContext(SyncActionsContext);
	if (!runtime || !actions) throw new Error("SyncProvider is missing");
	return { ...runtime, ...actions };
}

export function useOptionalSyncActions() {
	return useContext(SyncActionsContext);
}
