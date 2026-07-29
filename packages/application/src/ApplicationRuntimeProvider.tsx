import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ApplicationRuntime } from "./runtime";

const ApplicationRuntimeContext = createContext<ApplicationRuntime | null>(
	null,
);

export type ApplicationRuntimeProviderProps = {
	runtime: ApplicationRuntime;
	children: ReactNode;
};

export function ApplicationRuntimeProvider({
	runtime,
	children,
}: ApplicationRuntimeProviderProps) {
	return (
		<ApplicationRuntimeContext.Provider value={runtime}>
			{children}
		</ApplicationRuntimeContext.Provider>
	);
}

export function useApplicationRuntime(): ApplicationRuntime {
	const runtime = useContext(ApplicationRuntimeContext);
	if (!runtime)
		throw new Error(
			"useApplicationRuntime must be used inside an ApplicationRuntimeProvider",
		);
	return runtime;
}

export type AsyncState<T> =
	| { status: "loading" }
	| { status: "ready"; data: T }
	| { status: "error"; error: Error };

/**
 * Reads through a capability and revalidates whenever the runtime reports a
 * store change. Keeps shared views free of any platform data-fetching library.
 */
export function useApplicationValue<T>(
	load: () => Promise<T>,
	deps: readonly unknown[],
): AsyncState<T> & { refresh: () => void } {
	const runtime = useApplicationRuntime();
	const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
	const [nonce, setNonce] = useState(0);
	const loadRef = useRef(load);
	loadRef.current = load;

	const refresh = useCallback(() => setNonce((value) => value + 1), []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the caller declares the read's dependencies, and `nonce` is the explicit revalidation trigger.
	useEffect(() => {
		let active = true;
		loadRef
			.current()
			.then((data) => active && setState({ status: "ready", data }))
			.catch(
				(error: unknown) =>
					active &&
					setState({
						status: "error",
						error: error instanceof Error ? error : new Error("Request failed"),
					}),
			);
		return () => {
			active = false;
		};
	}, [...deps, nonce]);

	useEffect(() => runtime.cards.subscribe(refresh), [runtime.cards, refresh]);

	return { ...state, refresh };
}
