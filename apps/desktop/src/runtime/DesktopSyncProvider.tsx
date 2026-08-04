import type { SyncRuntimeState } from "@contextboard/application";
import {
	type BearerSessionUser,
	exchangeOneTimeToken,
	fetchBearerSession,
} from "@contextboard/auth-client";
import {
	HttpSyncError,
	HttpSyncTransport,
	SyncCoordinator,
} from "@contextboard/client-core";
import type { WorkspaceMembership } from "@contextboard/sync-protocol";
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
import { useDesktopRuntime } from "./DesktopRuntimeProvider";
import {
	awaitDesktopAuthToken,
	cancelDesktopAuth,
	clearDesktopSessionToken,
	type Invoke,
	readDesktopSessionToken,
	startDesktopAuth,
	storeDesktopSessionToken,
} from "./repository";

/**
 * Desktop sync driver. It mirrors the Web provider's lifecycle (bootstrap with
 * backoff, debounced push, polled pull, focus/online nudges) over the SQLite
 * repository, and authenticates with a keyring-stored bearer token instead of a
 * cookie session. Checkpoints are Web-only: this client replays the change log
 * from its persisted cursor.
 */

const SYNC_BASE_URL = (
	import.meta.env.VITE_CONTEXTBOARD_SYNC_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

function isOffline() {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * `fetch` reports an unreachable host and a blocked cross-origin response the
 * same opaque way, and both are configuration problems rather than bugs. Name
 * the likely cause instead of surfacing "Failed to fetch".
 */
export function describeSyncFailure(error: unknown, baseURL = SYNC_BASE_URL) {
	if (error instanceof HttpSyncError)
		return error.status === 403
			? "This account cannot access the desktop workspace"
			: error.message;
	const message = error instanceof Error ? error.message : String(error);
	// The coordinator reports its failures as plain strings, so the original
	// TypeError is only recognizable by its message by the time it lands here.
	if (
		error instanceof TypeError ||
		/failed to fetch|load failed|networkerror|fetch failed/i.test(message)
	)
		return `Cannot reach ${baseURL}. Check that the Web app is running (bun run dev) and that CONTEXTBOARD_DESKTOP_ORIGINS allows this app's origin.`;
	return message;
}

const DEBOUNCE_MS = 500;
const VISIBLE_POLL_MS = 2_000;
const HIDDEN_POLL_MS = 30_000;

class WorkspaceSelectionRequiredError extends Error {
	constructor() {
		super(
			"This local workspace is not linked to the signed-in account. Choose an account workspace or explicitly create a new workspace.",
		);
		this.name = "WorkspaceSelectionRequiredError";
	}
}

export type DesktopSyncRuntime = {
	state: SyncRuntimeState;
	message?: string;
	pendingCount: number;
	account: BearerSessionUser | null;
	signIn: () => Promise<void>;
	signOut: () => Promise<void>;
	syncNow: () => Promise<void>;
	createWorkspace: () => Promise<void>;
	workspaces: WorkspaceMembership[];
	switchWorkspace: (workspaceId: string) => Promise<void>;
	mergeIntoActiveWorkspace: (workspaceId: string) => Promise<void>;
	deleteLocalWorkspace: (workspaceId: string) => Promise<void>;
	workspaceSelectionRequired: boolean;
};

const DesktopSyncContext = createContext<DesktopSyncRuntime | null>(null);

export function DesktopSyncProvider({
	children,
	invoke,
}: {
	children: ReactNode;
	invoke?: Invoke;
}) {
	const desktop = useDesktopRuntime();
	const repository = desktop.status === "ready" ? desktop.repository : null;
	const workspaceId = desktop.status === "ready" ? desktop.workspaceId : null;
	const adoptWorkspaceId =
		desktop.status === "ready" ? desktop.adoptWorkspaceId : null;
	const setWorkspaceId =
		desktop.status === "ready" ? desktop.setWorkspaceId : null;
	const mergeWorkspace =
		desktop.status === "ready" ? desktop.mergeWorkspace : null;
	const deleteWorkspace =
		desktop.status === "ready" ? desktop.deleteWorkspace : null;

	const [token, setToken] = useState<string | null>(null);
	const [account, setAccount] = useState<BearerSessionUser | null>(null);
	const [state, setState] = useState<SyncRuntimeState>(
		desktop.status === "storage-unavailable" ? "unavailable" : "local-only",
	);
	const [message, setMessage] = useState<string | undefined>();
	const [pendingCount, setPendingCount] = useState(0);
	const [bootstrapNonce, setBootstrapNonce] = useState(0);
	const [workspaceSelectionRequired, setWorkspaceSelectionRequired] =
		useState(false);
	const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);

	const tokenRef = useRef<string | null>(null);
	tokenRef.current = token;
	const coordinatorRef = useRef<SyncCoordinator | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const syncNowRef = useRef<() => Promise<boolean>>(async () => false);
	const refreshPendingRef = useRef<() => Promise<void>>(async () => undefined);

	refreshPendingRef.current = async () => {
		if (!repository) return;
		const pending = await repository.getPendingBatches(100).catch(() => null);
		if (pending) setPendingCount(pending.length);
	};

	// Restore a previous session before deciding whether sync can run at all.
	useEffect(() => {
		let active = true;
		void readDesktopSessionToken(invoke)
			.then((stored) => {
				if (active && stored) setToken(stored);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [invoke]);

	const forgetSession = useCallback(async () => {
		coordinatorRef.current?.stop();
		coordinatorRef.current = null;
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
			debounceRef.current = null;
		}
		setToken(null);
		setAccount(null);
		setState("local-only");
		setMessage(undefined);
		setWorkspaceSelectionRequired(false);
		setWorkspaces([]);
		await clearDesktopSessionToken(invoke).catch(() => undefined);
	}, [invoke]);

	syncNowRef.current = async () => {
		const coordinator = coordinatorRef.current;
		if (
			!coordinator ||
			coordinator.status.state === "local-only" ||
			isOffline()
		)
			return false;
		try {
			await coordinator.syncNow();
			const stateAfterSync: string = coordinator.status.state;
			if (
				coordinatorRef.current !== coordinator ||
				stateAfterSync === "local-only" ||
				isOffline()
			)
				return false;
			setMessage(undefined);
		} catch (error) {
			if (error instanceof HttpSyncError && error.status === 401) {
				await forgetSession();
				return false;
			}
			if (error instanceof HttpSyncError && error.redirectWorkspaceId) {
				coordinator.stop();
				if (coordinatorRef.current === coordinator)
					coordinatorRef.current = null;
				if (adoptWorkspaceId) await adoptWorkspaceId(error.redirectWorkspaceId);
				return false;
			}
			throw error;
		} finally {
			await refreshPendingRef.current();
		}
		return true;
	};

	const syncNow = useCallback(async () => {
		await syncNowRef.current();
	}, []);

	const createWorkspace = useCallback(async () => {
		if (!repository || !workspaceId || !tokenRef.current)
			throw new Error("Sign in before creating a workspace");
		const transport = new HttpSyncTransport({
			baseURL: SYNC_BASE_URL,
			credentials: "omit",
			getAuthHeaders: () => ({
				authorization: `Bearer ${tokenRef.current}`,
			}),
		});
		await transport.claimWorkspace({
			workspaceId,
			deviceId: await repository.deviceId(),
		});
		setState("syncing");
		setMessage(undefined);
		setWorkspaceSelectionRequired(false);
		setBootstrapNonce((current) => current + 1);
	}, [repository, workspaceId]);

	const switchWorkspace = useCallback(
		async (nextWorkspaceId: string) => {
			if (!repository || !workspaceId || !setWorkspaceId || !tokenRef.current)
				throw new Error("Sign in before switching workspaces");
			const transport = new HttpSyncTransport({
				baseURL: SYNC_BASE_URL,
				credentials: "omit",
				getAuthHeaders: () => ({
					authorization: `Bearer ${tokenRef.current}`,
				}),
			});
			await transport.selectWorkspace(nextWorkspaceId);
			await setWorkspaceId(nextWorkspaceId);
			setState("syncing");
			setMessage(undefined);
			setWorkspaceSelectionRequired(false);
			setBootstrapNonce((current) => current + 1);
		},
		[repository, setWorkspaceId, workspaceId],
	);

	const mergeIntoActiveWorkspace = useCallback(
		async (sourceWorkspaceId: string) => {
			if (!workspaceId || !mergeWorkspace || !deleteWorkspace)
				throw new Error("The desktop workspace is not ready");
			if (sourceWorkspaceId === workspaceId)
				throw new Error("The active workspace cannot be merged into itself");
			await mergeWorkspace(sourceWorkspaceId);
			if (!(await syncNowRef.current()))
				throw new Error(
					"The merged workspace could not be synced. The local source was kept.",
				);
			await deleteWorkspace(sourceWorkspaceId);
		},
		[deleteWorkspace, mergeWorkspace, workspaceId],
	);

	const deleteLocalWorkspace = useCallback(
		async (sourceWorkspaceId: string) => {
			if (!workspaceId || !deleteWorkspace)
				throw new Error("The desktop workspace is not ready");
			if (sourceWorkspaceId === workspaceId)
				throw new Error("The active workspace cannot be deleted");
			await deleteWorkspace(sourceWorkspaceId);
		},
		[deleteWorkspace, workspaceId],
	);

	// Local writes schedule a push; remote applies deliberately do not, so the
	// coordinator cannot re-arm itself in a loop.
	useEffect(() => {
		if (!repository) return;
		return repository.subscribeLocal(() => {
			void refreshPendingRef.current();
			if (!coordinatorRef.current) return;
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(
				() => void syncNow().catch(() => undefined),
				DEBOUNCE_MS,
			);
		});
	}, [repository, syncNow]);

	useEffect(() => {
		if (!repository || !workspaceId || !adoptWorkspaceId) return;
		void refreshPendingRef.current();
		if (!token) {
			coordinatorRef.current?.stop();
			coordinatorRef.current = null;
			setState("local-only");
			return;
		}

		let active = true;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const controller = new AbortController();
		const transport = new HttpSyncTransport({
			baseURL: SYNC_BASE_URL,
			// Desktop is cross-origin and authenticates by bearer token. Sending
			// cookies would require Access-Control-Allow-Credentials, which the
			// server deliberately withholds.
			credentials: "omit",
			getAuthHeaders: () =>
				tokenRef.current
					? { authorization: `Bearer ${tokenRef.current}` }
					: undefined,
		});

		const start = async () => {
			setState("syncing");
			const user = await fetchBearerSession(
				SYNC_BASE_URL,
				token,
				controller.signal,
			);
			if (!active) return;
			if (!user) {
				await forgetSession();
				return;
			}
			setAccount(user);

			const listing = await transport.listWorkspaces(controller.signal);
			if (!active) return;
			setWorkspaces(listing.workspaces);
			const currentMembership = listing.workspaces.find(
				(item) => item.workspaceId === workspaceId,
			);
			const redirect = (listing.redirects ?? []).find(
				(item) => item.fromWorkspaceId === workspaceId,
			);
			const defaultWorkspace =
				listing.workspaces.find((item) => item.isDefault) ??
				listing.workspaces[0];
			let activeWorkspaceId = workspaceId;
			if (redirect) {
				await adoptWorkspaceId(redirect.toWorkspaceId);
				return;
			}
			if (!currentMembership) {
				const hasData = await repository.hasData();
				if (!hasData && defaultWorkspace) {
					// A fresh install joins the account's existing workspace instead
					// of pushing an empty one alongside it.
					activeWorkspaceId = defaultWorkspace.workspaceId;
					await adoptWorkspaceId(activeWorkspaceId);
					// The repository is rebuilt on the new id; this effect re-runs.
					return;
				}
				if (hasData) throw new WorkspaceSelectionRequiredError();
				await transport.claimWorkspace(
					{
						workspaceId,
						deviceId: await repository.deviceId(),
					},
					controller.signal,
				);
			}
			if (!active) return;

			const coordinator = new SyncCoordinator(
				activeWorkspaceId,
				repository,
				transport,
			);
			coordinatorRef.current = coordinator;
			coordinator.subscribe((next) => {
				if (!active) return;
				setState(next.state);
				setMessage(
					next.error === undefined
						? undefined
						: describeSyncFailure(next.error),
				);
			});
			await syncNow().catch(() => undefined);
			if (!active || coordinatorRef.current !== coordinator) return;

			const schedulePull = () => {
				const delay =
					coordinator.status.state === "error"
						? coordinator.retryDelay()
						: document.hidden
							? HIDDEN_POLL_MS
							: VISIBLE_POLL_MS;
				const timer = setTimeout(async () => {
					timers.delete(timer);
					await syncNow().catch(() => undefined);
					if (active && coordinatorRef.current === coordinator) schedulePull();
				}, delay);
				timers.add(timer);
			};
			schedulePull();
		};

		let failures = 0;
		let starting = false;
		const attemptStart = async () => {
			if (!active || starting || coordinatorRef.current) return;
			if (isOffline()) {
				setState("offline");
				return;
			}
			starting = true;
			try {
				await start();
				failures = 0;
			} catch (error) {
				if (!active || controller.signal.aborted) return;
				if (error instanceof HttpSyncError && error.status === 401) {
					await forgetSession();
					return;
				}
				if (error instanceof WorkspaceSelectionRequiredError) {
					setState("error");
					setMessage(error.message);
					setWorkspaceSelectionRequired(true);
					return;
				}
				failures += 1;
				setState(isOffline() ? "offline" : "error");
				setMessage(describeSyncFailure(error));
				const timer = setTimeout(
					() => {
						timers.delete(timer);
						void attemptStart();
					},
					Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6)),
				);
				timers.add(timer);
			} finally {
				starting = false;
			}
		};
		void attemptStart();

		const immediate = () => {
			if (coordinatorRef.current) void syncNow().catch(() => undefined);
			else void attemptStart();
		};
		window.addEventListener("focus", immediate);
		window.addEventListener("online", immediate);
		return () => {
			active = false;
			controller.abort();
			coordinatorRef.current?.stop();
			coordinatorRef.current = null;
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			for (const timer of timers) clearTimeout(timer);
			window.removeEventListener("focus", immediate);
			window.removeEventListener("online", immediate);
		};
	}, [
		adoptWorkspaceId,
		bootstrapNonce,
		forgetSession,
		repository,
		syncNow,
		token,
		workspaceId,
	]);

	const signIn = useCallback(async () => {
		setMessage(undefined);
		setState("syncing");
		setWorkspaceSelectionRequired(false);
		try {
			await startDesktopAuth(SYNC_BASE_URL, invoke);
			const oneTimeToken = await awaitDesktopAuthToken(invoke);
			const session = await exchangeOneTimeToken(SYNC_BASE_URL, oneTimeToken);
			await storeDesktopSessionToken(session, invoke);
			setToken(session);
		} catch (error) {
			await cancelDesktopAuth(invoke).catch(() => undefined);
			setState("local-only");
			// The sidebar renders what this throws, so it must be readable.
			throw new Error(describeSyncFailure(error));
		}
	}, [invoke]);

	const signOut = useCallback(async () => {
		await forgetSession();
	}, [forgetSession]);

	const value = useMemo<DesktopSyncRuntime>(
		() => ({
			state: desktop.status === "storage-unavailable" ? "unavailable" : state,
			message,
			pendingCount,
			account,
			signIn,
			signOut,
			syncNow,
			createWorkspace,
			workspaces,
			switchWorkspace,
			mergeIntoActiveWorkspace,
			deleteLocalWorkspace,
			workspaceSelectionRequired,
		}),
		[
			account,
			desktop.status,
			message,
			pendingCount,
			signIn,
			signOut,
			state,
			syncNow,
			createWorkspace,
			workspaces,
			switchWorkspace,
			mergeIntoActiveWorkspace,
			deleteLocalWorkspace,
			workspaceSelectionRequired,
		],
	);

	return (
		<DesktopSyncContext.Provider value={value}>
			{children}
		</DesktopSyncContext.Provider>
	);
}

export function useDesktopSync() {
	const value = useContext(DesktopSyncContext);
	if (!value)
		throw new Error("useDesktopSync must be used inside DesktopSyncProvider");
	return value;
}
