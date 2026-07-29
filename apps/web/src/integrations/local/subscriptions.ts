import type { ContextboardDatabase } from "@contextboard/local-db";

const listeners = new WeakMap<
	ContextboardDatabase,
	Set<() => void>
>();

export function subscribeToLocalDatabaseChanges(
	database: ContextboardDatabase,
	listener: () => void,
) {
	let databaseListeners = listeners.get(database);
	if (!databaseListeners) {
		databaseListeners = new Set();
		listeners.set(database, databaseListeners);
	}
	databaseListeners.add(listener);
	return () => {
		databaseListeners?.delete(listener);
	};
}

export function notifyLocalDatabaseChange(database: ContextboardDatabase) {
	for (const listener of listeners.get(database) ?? []) listener();
}
