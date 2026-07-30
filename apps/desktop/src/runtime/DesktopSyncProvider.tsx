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

export type DesktopSyncRuntime = {
	state: SyncRuntimeState;
	message?: string;
	pendingCount: number;
	account: BearerSessionUser | null;
	signIn: () => Promise<void>;
	signOut: () => Promise<void>;
	syncNow: () => Promise<void>;
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

	const [token, setToken] = useState<string | null>(null);
	const [account, setAccount] = useState<BearerSessionUser | null>(null);
	const [state, setState] = useState<SyncRuntimeState>(
		desktop.status === "storage-unavailable" ? "unavailable" : "local-only",
	);
	const [message, setMessage] = useState<string | undefined>();
	const [pendingCount, setPendingCount] = useState(0);

	const tokenRef = useRef<string | null>(null);
	tokenRef.current = token;
	const coordinatorRef = useRef<SyncCoordinator | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const syncNowRef = useRef<() => Promise<void>>(async () => undefined);
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
		await clearDesktopSessionToken(invoke).catch(() => undefined);
	}, [invoke]);

	syncNowRef.current = async () => {
		const coordinator = coordinatorRef.current;
		if (!coordinator || isOffline()) return;
		try {
			await coordinator.syncNow();
			setMessage(undefined);
		} catch (error) {
			if (error instanceof HttpSyncError && error.status === 401) {
				await forgetSession();
				return;
			}
			throw error;
		} finally {
			await refreshPendingRef.current();
		}
	};

	const syncNow = useCallback(async () => {
		await syncNowRef.current();
	}, []);

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
			let activeWorkspaceId = workspaceId;
			if (
				!listing.workspaces.some((item) => item.workspaceId === workspaceId)
			) {
				const hasData = await repository.hasData();
				if (!hasData && listing.workspaces[0]) {
					// A fresh install joins the account's existing workspace instead
					// of pushing an empty one alongside it.
					activeWorkspaceId = listing.workspaces[0].workspaceId;
					await adoptWorkspaceId(activeWorkspaceId);
					// The repository is rebuilt on the new id; this effect re-runs.
					return;
				}
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
		forgetSession,
		repository,
		syncNow,
		token,
		workspaceId,
	]);

	const signIn = useCallback(async () => {
		setMessage(undefined);
		setState("syncing");
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
