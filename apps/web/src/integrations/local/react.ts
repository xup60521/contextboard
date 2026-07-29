import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useContext, useMemo } from "react";
import { useOptionalSyncActions } from "../sync/provider";
import { localMutation, localQuery } from "./operations";
import { LocalDatabaseContext } from "./provider";
import { notifyLocalDatabaseChange } from "./subscriptions";

type Reference = string;
type Arguments = Record<string, unknown> | "skip" | undefined;
type KeyedQueryResult<T> = {
	key: string;
	value: T;
};

function useLocalState() {
	const state = useContext(LocalDatabaseContext);
	if (!state) throw new Error("Local database provider is missing");
	return state;
}

export function useQuery(reference: Reference, args?: Arguments): any {
	const state = useLocalState();
	const { database } = state;
	const key = JSON.stringify([reference, args]);
	const result = useLiveQuery<KeyedQueryResult<unknown> | undefined>(
		async () =>
			args === "skip" || state.status !== "ready"
				? undefined
				: {
						key,
						value: await localQuery(database, reference, args ?? {}),
					},
		[database, reference, key, state.status],
	);
	return result?.key === key ? result.value : undefined;
}

export function useMutation(
	reference: Reference,
): (args?: Record<string, unknown>) => Promise<any> {
	const state = useLocalState();
	const syncActions = useOptionalSyncActions();
	return useCallback(
		async (args = {}) => {
			if (state.status !== "ready")
				throw state.status === "error"
					? state.error
					: new Error("Local database is opening");
			const result = await localMutation(
				state.database,
				state.deviceId,
				reference,
				args,
			);
			syncActions?.notifyLocalChange();
			notifyLocalDatabaseChange(state.database);
			return result;
		},
		[reference, state, syncActions],
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
