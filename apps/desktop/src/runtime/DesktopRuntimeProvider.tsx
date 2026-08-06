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
import {
	bootstrapDesktop,
	createDesktopRepository,
	invokeDesktop,
	type Invoke,
	readDesktopSetting,
	writeDesktopSetting,
} from "./repository";
import type { DesktopRuntimeState } from "./types";

/**
 * Workspace id used until this device either claims it on the server or adopts
 * an existing workspace from the signed-in account.
 */
export const DEFAULT_DESKTOP_WORKSPACE_ID = "contextboard-desktop";

const DesktopRuntimeContext = createContext<DesktopRuntimeState | null>(null);

/**
 * The native bridge this app was built with. Components rendered inside the
 * router cannot receive the `invoke` prop, but they still must not fall back to
 * the real Tauri IPC when a stub was injected — that silently bypasses the
 * harness under test and the shell under Storybook-style rendering.
 */
const DesktopInvokeContext = createContext<Invoke | undefined>(undefined);

export function useDesktopInvoke(): Invoke | undefined {
	return useContext(DesktopInvokeContext);
}

/**
 * Storage state as bootstrap produces it. `adoptWorkspaceId` is a provider
 * concern, so it is attached on the way out rather than stored.
 */
type DesktopStorageState =
	| Exclude<DesktopRuntimeState, { status: "ready" }>
	| Omit<
			Extract<DesktopRuntimeState, { status: "ready" }>,
			| "adoptWorkspaceId"
			| "setWorkspaceId"
			| "mergeWorkspace"
			| "deleteWorkspace"
	  >;

export type DesktopRuntimeProviderProps = {
	children: ReactNode;
	invoke?: Invoke;
};

/**
 * Subscribing to native events is an optimization: it turns a bridge write into
 * an immediate repaint and push. Where there is no event host — tests, a stubbed
 * repository — the sync poll timer remains the backstop, so a failure here must
 * never fail startup.
 */
async function connectQuietly(repository: {
	connect?: () => Promise<() => void>;
}): Promise<() => void> {
	try {
		return (await repository.connect?.()) ?? (() => undefined);
	} catch {
		return () => undefined;
	}
}

function markDesktopPerformance(name: string) {
	try {
		if (typeof performance !== "undefined") performance.mark(name);
	} catch {
		// Performance marks are diagnostics only.
	}
}

export function DesktopRuntimeProvider({
	children,
	invoke,
}: DesktopRuntimeProviderProps) {
	const [state, setState] = useState<DesktopStorageState>({
		status: "starting",
	});

	/**
	 * Unsubscribes the current repository from native workspace-changed events.
	 * Held here because the repository is built — and rebuilt on adoption — by
	 * this provider, and a leaked listener would repaint against the old store.
	 */
	const disconnect = useRef<(() => void) | null>(null);
	const activeRef = useRef(false);
	const connectionGeneration = useRef(0);
	const connectRepository = useCallback(
		(repository: Parameters<typeof connectQuietly>[0]) => {
			const generation = ++connectionGeneration.current;
			disconnect.current?.();
			disconnect.current = null;
			void connectQuietly(repository).then((stop) => {
				if (!activeRef.current || connectionGeneration.current !== generation) {
					stop();
					return;
				}
				disconnect.current = stop;
			});
		},
		[],
	);

	useEffect(() => {
		let active = true;
		activeRef.current = true;
		const startupGeneration = ++connectionGeneration.current;

		void (async () => {
			try {
				const [bootstrap, storedWorkspaceId] = await Promise.all([
					bootstrapDesktop(invoke),
					readDesktopSetting("workspaceId", invoke),
				]);
				const workspaceId = storedWorkspaceId ?? DEFAULT_DESKTOP_WORKSPACE_ID;
				if (
					!active ||
					!activeRef.current ||
					connectionGeneration.current !== startupGeneration
				)
					return;
				const repository = createDesktopRepository(workspaceId, invoke);
				markDesktopPerformance("contextboard:desktop-runtime-ready");
				setState(
					bootstrap.storageAvailable
						? { status: "ready", repository, workspaceId, bootstrap }
						: {
								status: "storage-unavailable",
								repository,
								bootstrap,
								reason: "Desktop storage is not available in this build",
							},
				);
				// Native event subscription is useful for freshness but is not needed
				// before the first usable render.
				connectRepository(repository);
			} catch (error: unknown) {
				if (!active) return;
				setState({
					status: "error",
					error:
						error instanceof Error
							? error
							: new Error("Desktop startup failed"),
				});
			}
		})();

		return () => {
			active = false;
			activeRef.current = false;
			connectionGeneration.current += 1;
			disconnect.current?.();
			disconnect.current = null;
		};
	}, [connectRepository, invoke]);

	/**
	 * Moves this device onto a server-issued workspace id. The repository is
	 * bound to its workspace at construction, so it is rebuilt here.
	 */
	const adoptWorkspaceId = useCallback(
		async (nextWorkspaceId: string) => {
			if (state.status !== "ready" || state.workspaceId === nextWorkspaceId)
				return;
			await state.repository.adopt(nextWorkspaceId);
			await writeDesktopSetting("workspaceId", nextWorkspaceId, invoke);
			const repository = createDesktopRepository(nextWorkspaceId, invoke);
			connectRepository(repository);
			setState((current) =>
				current.status === "ready"
					? { ...current, workspaceId: nextWorkspaceId, repository }
					: current,
			);
		},
		[connectRepository, invoke, state],
	);

	/**
	 * Selects a workspace without moving any rows. Each repository is bound to
	 * its id, so switching tears down the old listener and creates a new adapter.
	 */
	const setWorkspaceId = useCallback(
		async (nextWorkspaceId: string) => {
			if (state.status !== "ready" || state.workspaceId === nextWorkspaceId)
				return;
			await writeDesktopSetting("workspaceId", nextWorkspaceId, invoke);
			const repository = createDesktopRepository(nextWorkspaceId, invoke);
			connectRepository(repository);
			setState((current) =>
				current.status === "ready"
					? { ...current, workspaceId: nextWorkspaceId, repository }
					: current,
			);
		},
		[connectRepository, invoke, state],
	);

	const mergeWorkspace = useCallback(
		async (fromWorkspaceId: string) => {
			if (state.status !== "ready" || state.workspaceId === fromWorkspaceId)
				return;
			await invokeDesktop(
				"workspace_merge",
				{ from: fromWorkspaceId, to: state.workspaceId },
				invoke,
			);
		},
		[invoke, state],
	);

	const deleteWorkspace = useCallback(
		async (workspaceId: string) => {
			if (state.status !== "ready")
				throw new Error("The desktop workspace is not ready");
			if (state.workspaceId === workspaceId)
				throw new Error("The active workspace cannot be deleted");
			await invokeDesktop("workspace_delete", { workspaceId }, invoke);
		},
		[invoke, state],
	);

	const value = useMemo<DesktopRuntimeState>(
		() =>
			state.status === "ready"
				? {
						...state,
						adoptWorkspaceId,
						setWorkspaceId,
						mergeWorkspace,
						deleteWorkspace,
					}
				: state,
		[adoptWorkspaceId, deleteWorkspace, mergeWorkspace, setWorkspaceId, state],
	);

	return (
		<DesktopInvokeContext.Provider value={invoke}>
			<DesktopRuntimeContext.Provider value={value}>
				{children}
			</DesktopRuntimeContext.Provider>
		</DesktopInvokeContext.Provider>
	);
}

export function useDesktopRuntime() {
	const value = useContext(DesktopRuntimeContext);
	if (!value)
		throw new Error(
			"useDesktopRuntime must be used inside DesktopRuntimeProvider",
		);
	return value;
}
