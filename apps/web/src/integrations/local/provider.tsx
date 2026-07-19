import type { ContextboardDatabase } from "@contextboard/local-db";
import {
	cleanupOrphanedFiles,
	createContextboardDatabase,
	ensureLocalIdentity,
} from "@contextboard/local-db";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type LocalDatabaseState =
	| {
			status: "opening";
			database: ContextboardDatabase;
			workspaceId: null;
			deviceId: null;
			error: null;
	  }
	| {
			status: "ready";
			database: ContextboardDatabase;
			workspaceId: string;
			deviceId: string;
			error: null;
	  }
	| {
			status: "error";
			database: ContextboardDatabase;
			workspaceId: null;
			deviceId: null;
			error: Error;
	  };

export const LocalDatabaseContext = createContext<LocalDatabaseState | null>(
	null,
);

export function LocalDatabaseProvider({ children }: { children: ReactNode }) {
	const database = useMemo(() => createContextboardDatabase(), []);
	const [state, setState] = useState<LocalDatabaseState>({
		status: "opening",
		database,
		workspaceId: null,
		deviceId: null,
		error: null,
	});

	useEffect(() => {
		let active = true;
		void ensureLocalIdentity(database).then(
			({ workspaceId, deviceId }) => {
				if (!active) return;
				setState({
					status: "ready",
					database,
					workspaceId,
					deviceId,
					error: null,
				});
				void cleanupOrphanedFiles(database);
				void navigator.storage?.persist?.();
			},
			(reason: unknown) =>
				active &&
				setState({
					status: "error",
					database,
					workspaceId: null,
					deviceId: null,
					error: reason instanceof Error ? reason : new Error(String(reason)),
				}),
		);
		return () => {
			active = false;
		};
	}, [database]);

	return (
		<LocalDatabaseContext.Provider value={state}>
			{children}
		</LocalDatabaseContext.Provider>
	);
}

export function useLocalDatabase() {
	const state = useContext(LocalDatabaseContext);
	if (!state)
		throw new Error(
			"useLocalDatabase must be used inside LocalDatabaseProvider",
		);
	return state;
}
