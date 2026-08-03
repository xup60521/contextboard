import type {
	DomainCommand,
	DomainQuery,
	WorkspaceChangeListener,
	WorkspaceRepository,
} from "@contextboard/client-core";
import {
	acknowledgeBatches,
	applyRemoteBatches,
	getLocalBlob,
	getMissingBlobs,
	getPendingBatches,
	getSyncState,
	storeRemoteBlob,
} from "@contextboard/local-db";
import type { ContextboardDatabaseLike } from "@contextboard/local-db";
import { executeEntityCommand, queryEntities } from "./entity-store";

/**
 * IndexedDB implementation of the shared repository boundary: the same
 * allowlisted domain operations the Desktop SQLite backend serves, plus the
 * synchronization surface. Rich Web-only operations still live in the Web
 * application adapter.
 */
/** Repository adapter for any local database implementing the shared table API. */
export class LocalWorkspaceRepository implements WorkspaceRepository {
	#listeners = new Set<WorkspaceChangeListener>();
	#localListeners = new Set<WorkspaceChangeListener>();

	constructor(private readonly database: ContextboardDatabaseLike) {}

	query<T>(query: DomainQuery<T>): Promise<T> {
		return queryEntities(this.database, query) as Promise<T>;
	}

	async execute<T>(command: DomainCommand<T>): Promise<T> {
		const result = await executeEntityCommand(this.database, command);
		for (const listener of this.#listeners) listener();
		for (const listener of this.#localListeners) listener();
		return result as T;
	}

	subscribe(listener: WorkspaceChangeListener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	subscribeLocal(listener: WorkspaceChangeListener) {
		this.#localListeners.add(listener);
		return () => this.#localListeners.delete(listener);
	}

	getPendingBatches(limit: number) {
		return getPendingBatches(this.database, limit);
	}

	acknowledge(changeIds: string[]) {
		return acknowledgeBatches(this.database, changeIds);
	}

	async applyRemote(
		batches: Parameters<typeof applyRemoteBatches>[1],
		peerId: string,
		nextCursor: string,
	) {
		const workspaceId = (await this.database.settings.get("workspaceId"))
			?.value;
		if (
			typeof workspaceId !== "string" ||
			batches.some((batch) => batch.workspaceId !== workspaceId)
		)
			throw new Error("Remote batch workspace does not match this database");
		const result = await applyRemoteBatches(
			this.database,
			batches,
			peerId,
			nextCursor,
		);
		for (const listener of this.#listeners) listener();
		return result;
	}

	getSyncState(peerId: string) {
		return getSyncState(this.database, peerId);
	}

	getLocalBlob(hash: string) {
		return getLocalBlob(this.database, hash);
	}

	getMissingBlobs() {
		return getMissingBlobs(this.database);
	}

	storeRemoteBlob(
		descriptor: Parameters<typeof storeRemoteBlob>[1],
		blob: Blob,
	) {
		return storeRemoteBlob(this.database, descriptor, blob);
	}
}

/** Compatibility name retained for the browser IndexedDB integration. */
export class IndexedDbWorkspaceRepository extends LocalWorkspaceRepository {}

/** Explicit name for the headless SQLite replica integration. */
export class SqliteWorkspaceRepository extends LocalWorkspaceRepository {}

export * from "@contextboard/local-db";
export {
	executeEntityCommand,
	InvalidDomainArgumentError,
	queryEntities,
	UnknownDomainOperationError,
} from "./entity-store";
