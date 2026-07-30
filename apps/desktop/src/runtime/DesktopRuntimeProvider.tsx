import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	bootstrapDesktop,
	createDesktopRepository,
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
 * Storage state as bootstrap produces it. `adoptWorkspaceId` is a provider
 * concern, so it is attached on the way out rather than stored.
 */
type DesktopStorageState =
	| Exclude<DesktopRuntimeState, { status: "ready" }>
	| Omit<Extract<DesktopRuntimeState, { status: "ready" }>, "adoptWorkspaceId">;

export type DesktopRuntimeProviderProps = {
	children: ReactNode;
	invoke?: Invoke;
};

export function DesktopRuntimeProvider({
	children,
	invoke,
}: DesktopRuntimeProviderProps) {
	const [state, setState] = useState<DesktopStorageState>({
		status: "starting",
	});

	useEffect(() => {
		let active = true;

		void (async () => {
			try {
				const bootstrap = await bootstrapDesktop(invoke);
				const workspaceId =
					(await readDesktopSetting("workspaceId", invoke)) ??
					DEFAULT_DESKTOP_WORKSPACE_ID;
				if (!active) return;
				const repository = createDesktopRepository(workspaceId, invoke);
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
		};
	}, [invoke]);

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
			setState((current) =>
				current.status === "ready"
					? {
							...current,
							workspaceId: nextWorkspaceId,
							repository: createDesktopRepository(nextWorkspaceId, invoke),
						}
					: current,
			);
		},
		[invoke, state],
	);

	const value = useMemo<DesktopRuntimeState>(
		() => (state.status === "ready" ? { ...state, adoptWorkspaceId } : state),
		[adoptWorkspaceId, state],
	);

	return (
		<DesktopRuntimeContext.Provider value={value}>
			{children}
		</DesktopRuntimeContext.Provider>
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
