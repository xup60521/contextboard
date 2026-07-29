import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	bootstrapDesktop,
	createDesktopRepository,
	type Invoke,
} from "./repository";
import type { DesktopRuntimeState } from "./types";

const DESKTOP_WORKSPACE_ID = "contextboard-desktop";
const DesktopRuntimeContext = createContext<DesktopRuntimeState | null>(null);

export type DesktopRuntimeProviderProps = {
	children: ReactNode;
	invoke?: Invoke;
};

export function DesktopRuntimeProvider({
	children,
	invoke,
}: DesktopRuntimeProviderProps) {
	const [state, setState] = useState<DesktopRuntimeState>({
		status: "starting",
	});

	useEffect(() => {
		let active = true;
		const repository = createDesktopRepository(DESKTOP_WORKSPACE_ID, invoke);

		void bootstrapDesktop(invoke)
			.then((bootstrap) => {
				if (!active) return;
				if (!bootstrap.storageAvailable) {
					setState({
						status: "storage-unavailable",
						repository,
						bootstrap,
						reason: "Desktop storage is not available in this build",
					});
					return;
				}
				setState({
					status: "ready",
					repository,
					workspaceId: DESKTOP_WORKSPACE_ID,
					bootstrap,
				});
			})
			.catch((error: unknown) => {
				if (!active) return;
				setState({
					status: "error",
					error:
						error instanceof Error
							? error
							: new Error("Desktop startup failed"),
				});
			});

		return () => {
			active = false;
		};
	}, [invoke]);

	return (
		<DesktopRuntimeContext.Provider value={state}>
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
