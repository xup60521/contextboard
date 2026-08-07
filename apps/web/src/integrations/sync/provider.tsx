import { useSession } from "@contextboard/auth-client";
import {
	HttpSyncTransport,
	HttpSyncError,
	SyncCoordinator,
} from "@contextboard/client-core";
import {
	adoptWorkspaceId,
	hasWorkspaceData,
	rebindWorkspaceId,
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
import { getWebWorkspaceRepository } from "../application/repository";
import { bootstrapLatestCheckpoint, maybeCreateCheckpoint } from "./checkpoint";

export type SyncUiState = SyncStatus & {
	workspaceId: string | null;
	pendingCount: number;
	conflictCount: number;
	lastSyncedAt: number | null;
	workspaceSelectionRequired: boolean;
};

type SyncRuntime = {
	state: SyncUiState;
	signedIn: boolean;
	sessionPending: boolean;
};

type SyncActions = {
	syncNow: () => Promise<void>;
	notifyLocalChange: () => void;
	createWorkspace: () => Promise<void>;
};

class WorkspaceSelectionRequiredError extends Error {
	constructor() {
		super(
			"This local workspace is not linked to the signed-in account. Choose an account workspace or explicitly create a new workspace.",
		);
		this.name = "WorkspaceSelectionRequiredError";
	}
}

const initialState: SyncUiState = {
	state: "local-only",
	cursor: null,
	workspaceId: null,
	pendingCount: 0,
	conflictCount: 0,
	lastSyncedAt: null,
	workspaceSelectionRequired: false,
};

const SyncRuntimeContext = createContext<SyncRuntime | null>(null);
const SyncActionsContext = createContext<SyncActions | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
	const local = useLocalDatabase();
	const session = useSession();
	const userId = session.data?.user.id ?? null;
	const [state, setState] = useState(initialState);
	const [bootstrapNonce, setBootstrapNonce] = useState(0);
	const coordinatorRef = useRef<SyncCoordinator | null>(null);
	const checkpointRef = useRef<{
		transport: HttpSyncTransport;
		workspaceId: string;
	} | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const refreshCountsRef = useRef<() => Promise<void>>(async () => undefined);
	const syncNowRef = useRef<() => Promise<void>>(async () => undefined);
	const refetchSessionRef = useRef(session.refetch);
	refetchSessionRef.current = session.refetch;

	refreshCountsRef.current = async () => {
		if (local.status !== "ready") return;
		const [pendingCount, conflictCount] = await Promise.all([
			local.database.changeLog.count(),
			// Count through the cursor without materializing every conflict row.
			local.database.conflicts
				.filter((row) => row.resolvedAt === null)
				.count(),
		]);
		setState((current) => ({ ...current, pendingCount, conflictCount }));
	};

	syncNowRef.current = async () => {
		const coordinator = coordinatorRef.current;
		if (
			!coordinator ||
			(typeof navigator !== "undefined" && navigator.onLine === false)
		)
			return;
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
		} catch (error) {
			if (error instanceof HttpSyncError && error.status === 401) {
				coordinator.stop();
				if (coordinatorRef.current === coordinator)
					coordinatorRef.current = null;
				checkpointRef.current = null;
				if (debounceRef.current) {
					clearTimeout(debounceRef.current);
					debounceRef.current = null;
				}
				setState((current) => ({
					...current,
					state: "local-only",
					error: undefined,
				}));
				await refetchSessionRef.current();
				return;
			}
			if (
				error instanceof HttpSyncError &&
				error.redirectWorkspaceId &&
				local.status === "ready"
			) {
				coordinator.stop();
				if (coordinatorRef.current === coordinator)
					coordinatorRef.current = null;
				checkpointRef.current = null;
				await rebindWorkspaceId(
					local.database,
					local.workspaceId,
					error.redirectWorkspaceId,
				);
				local.updateWorkspaceIdentity(error.redirectWorkspaceId);
				return;
			}
			throw error;
		} finally {
			await refreshCountsRef.current();
		}
	};

	const syncNow = useCallback(() => syncNowRef.current(), []);

	const createWorkspace = useCallback(async () => {
		if (local.status !== "ready" || !userId)
			throw new Error("Sign in before creating a workspace");
		const transport = new HttpSyncTransport();
		await transport.claimWorkspace({
			workspaceId: local.workspaceId,
			deviceId: local.deviceId,
		});
		setState((current) => ({
			...current,
			state: "syncing",
			error: undefined,
			workspaceSelectionRequired: false,
		}));
		setBootstrapNonce((current) => current + 1);
	}, [local.deviceId, local.status, local.workspaceId, userId]);

	const notifyLocalChange = useCallback(() => {
		void refreshCountsRef.current();
		if (!coordinatorRef.current) return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => void syncNow(), 500);
	}, [syncNow]);

	useEffect(() => {
		if (local.status !== "ready") return;
		const unsubscribe = getWebWorkspaceRepository(
			local.database,
		).subscribeLocal(notifyLocalChange);
		return () => {
			unsubscribe();
		};
	}, [local, notifyLocalChange]);

	useEffect(() => {
		if (local.status !== "ready") return;
		void refreshCountsRef.current();
		if (!userId) {
			coordinatorRef.current?.stop();
			coordinatorRef.current = null;
			checkpointRef.current = null;
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			setState((current) => ({
				...current,
				state: "local-only",
				workspaceId: local.workspaceId,
				workspaceSelectionRequired: false,
			}));
			return;
		}

		let active = true;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const bootstrapController = new AbortController();
		const transport = new HttpSyncTransport();
		const start = async () => {
			setState((current) => ({
				...current,
				state: "syncing",
				workspaceId: local.workspaceId,
			}));
			const listing = await transport.listWorkspaces(
				bootstrapController.signal,
			);
			const currentMembership = listing.workspaces.find(
				(item) => item.workspaceId === local.workspaceId,
			);
			const redirect = (listing.redirects ?? []).find(
				(item) => item.fromWorkspaceId === local.workspaceId,
			);
			const defaultWorkspace =
				listing.workspaces.find((item) => item.isDefault) ??
				listing.workspaces[0];
			let workspaceId = local.workspaceId;
			if (redirect) {
				await rebindWorkspaceId(
					local.database,
					local.workspaceId,
					redirect.toWorkspaceId,
				);
				if (!active) return;
				local.updateWorkspaceIdentity(redirect.toWorkspaceId);
				return;
			}
			if (!currentMembership) {
				const hasData = await hasWorkspaceData(local.database);
				if (!hasData && defaultWorkspace) {
					workspaceId = defaultWorkspace.workspaceId;
					await adoptWorkspaceId(local.database, workspaceId);
					await bootstrapLatestCheckpoint(
						local.database,
						transport,
						workspaceId,
					);
					if (!active) return;
					local.updateWorkspaceIdentity(workspaceId);
				} else if (hasData) {
					throw new WorkspaceSelectionRequiredError();
				} else {
					await transport.claimWorkspace(
						{
							workspaceId,
							deviceId: local.deviceId,
						},
						bootstrapController.signal,
					);
				}
			}
			if (!active) return;
			const repository = getWebWorkspaceRepository(local.database);
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
			if (!active || coordinatorRef.current !== coordinator) return;

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
					if (active && coordinatorRef.current === coordinator) schedulePull();
				}, delay);
				timers.add(timer);
			};
			schedulePull();
		};
		let bootstrapFailures = 0;
		let bootstrapping = false;
		const attemptStart = async () => {
			if (!active || bootstrapping || coordinatorRef.current) return;
			if (typeof navigator !== "undefined" && navigator.onLine === false)
				return;
			bootstrapping = true;
			try {
				await start();
				bootstrapFailures = 0;
			} catch (error) {
				if (!active || bootstrapController.signal.aborted) return;
				if (error instanceof HttpSyncError && error.status === 401) {
					setState((current) => ({
						...current,
						state: "local-only",
						error: undefined,
					}));
					await refetchSessionRef.current();
					return;
				}
				if (error instanceof WorkspaceSelectionRequiredError) {
					setState((current) => ({
						...current,
						state: "error",
						error: error.message,
						workspaceSelectionRequired: true,
					}));
					return;
				}
				bootstrapFailures += 1;
				if (typeof navigator === "undefined" || navigator.onLine !== false)
					setState((current) => ({
						...current,
						state: "error",
						error: error instanceof Error ? error.message : String(error),
					}));
				const timer = setTimeout(
					() => {
						timers.delete(timer);
						void attemptStart();
					},
					Math.min(60_000, 1_000 * 2 ** Math.min(bootstrapFailures, 6)),
				);
				timers.add(timer);
			} finally {
				bootstrapping = false;
			}
		};
		void attemptStart();

		const immediate = () => {
			if (coordinatorRef.current) void syncNow().catch(() => undefined);
			else void attemptStart();
		};
		const flush = () =>
			void coordinatorRef.current?.syncNow().catch(() => undefined);
		window.addEventListener("focus", immediate);
		window.addEventListener("online", immediate);
		window.addEventListener("pagehide", flush);
		return () => {
			active = false;
			bootstrapController.abort();
			coordinatorRef.current?.stop();
			coordinatorRef.current = null;
			checkpointRef.current = null;
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			for (const timer of timers) clearTimeout(timer);
			window.removeEventListener("focus", immediate);
			window.removeEventListener("online", immediate);
			window.removeEventListener("pagehide", flush);
		};
	}, [bootstrapNonce, local, syncNow, userId]);

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
		() => ({ createWorkspace, notifyLocalChange, syncNow }),
		[createWorkspace, notifyLocalChange, syncNow],
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
