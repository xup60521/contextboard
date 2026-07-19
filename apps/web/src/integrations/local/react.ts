import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useContext, useMemo } from "react";
import { LocalDatabaseContext } from "./provider";
import { localMutation, localQuery } from "./operations";

type Reference = string;
type Arguments = Record<string, unknown> | "skip" | undefined;

function useLocalState() {
	const state = useContext(LocalDatabaseContext);
	if (!state) throw new Error("Local database provider is missing");
	return state;
}

export function useQuery(reference: Reference, args?: Arguments): any {
	const { database } = useLocalState();
	const key = JSON.stringify(args);
	return useLiveQuery(
		() =>
			args === "skip" ? undefined : localQuery(database, reference, args ?? {}),
		[database, reference, key],
	);
}

export function useMutation(
	reference: Reference,
): (args?: Record<string, unknown>) => Promise<any> {
	const state = useLocalState();
	return useCallback(
		(args = {}) => {
			if (state.status !== "ready")
				return Promise.reject(
					state.status === "error"
						? state.error
						: new Error("Local database is opening"),
				);
			return localMutation(state.database, state.deviceId, reference, args);
		},
		[reference, state],
	);
}

export function usePaginatedQuery(
	reference: Reference,
	args: Record<string, unknown>,
	_options: { initialNumItems: number },
): {
	results: any[];
	status: "LoadingFirstPage" | "CanLoadMore" | "Exhausted";
	loadMore: (count: number) => void;
} {
	const results = useQuery(reference, args) as any[] | undefined;
	return useMemo(
		() => ({
			results: results ?? [],
			status: results ? ("Exhausted" as const) : ("LoadingFirstPage" as const),
			loadMore: (_count: number) => undefined,
		}),
		[results],
	);
}

export function useLocalClient(): {
	query: (reference: Reference, args: Record<string, unknown>) => Promise<any>;
} {
	const { database } = useLocalState();
	return useMemo(
		() => ({
			query: (reference: Reference, args: Record<string, unknown>) =>
				localQuery(database, reference, args),
		}),
		[database],
	);
}
