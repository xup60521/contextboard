import {
	describeDomainCommand,
	describeRemoteBatches,
	recordContextboardPerf,
	workspaceChangeMatches,
	type DomainCommand,
	type DomainQuery,
	type WorkspaceChange,
	type WorkspaceChangeFilter,
	type WorkspaceChangeListener,
	type WorkspaceRepository,
} from "@contextboard/client-core";
import {
	acknowledgeBatches,
	applyRemoteBatches,
	getLocalBlob,
	getMissingBlobs,
	getPendingBatches,
	getSyncState,
	updateSyncCursor,
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
	#listeners = new Set<{
		listener: WorkspaceChangeListener;
		filter?: WorkspaceChangeFilter;
	}>();
	#localListeners = new Set<WorkspaceChangeListener>();

	constructor(private readonly database: ContextboardDatabaseLike) {}

	async query<T>(query: DomainQuery<T>): Promise<T> {
		recordContextboardPerf("repository.query", { detail: query.type });
		const result = await queryEntities(this.database, query) as T;
		if (Array.isArray(result))
			recordContextboardPerf("repository.rows", {
				detail: query.type,
				value: result.length,
			});
		return result;
	}

	async execute<T>(command: DomainCommand<T>): Promise<T> {
		recordContextboardPerf("repository.command", { detail: command.type });
		const result = await executeEntityCommand(this.database, command);
		const change: WorkspaceChange = {
			origin: "local",
			changes: describeDomainCommand(command),
		};
		this.#emit(change);
		for (const listener of this.#localListeners) listener(change);
		return result as T;
	}

	#emit(change: WorkspaceChange) {
		if (change.changes.length === 0) return;
		recordContextboardPerf("repository.notification.emitted", {
			detail: change.origin,
		});
		for (const subscription of this.#listeners) {
			if (!workspaceChangeMatches(change, subscription.filter)) continue;
			recordContextboardPerf("repository.notification.delivered", {
				detail: change.origin,
			});
			subscription.listener(change);
		}
	}

	subscribe(
		listener: WorkspaceChangeListener,
		filter?: WorkspaceChangeFilter,
	) {
		const subscription = { listener, filter };
		this.#listeners.add(subscription);
		return () => this.#listeners.delete(subscription);
	}

	subscribeLocal(listener: WorkspaceChangeListener) {
		this.#localListeners.add(listener);
		return () => this.#localListeners.delete(listener);
	}

	async getPendingBatches(limit: number) {
		const batches = await getPendingBatches(this.database, limit);
		recordContextboardPerf("repository.rows", {
			detail: "changeLog.pending",
			value: batches.length,
		});
		return batches;
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
		const changes = result.materializedChanges ?? [];
		this.#emit({
			origin: "remote",
			changes:
				changes.length > 0 && batches[0]
					? describeRemoteBatches([{ ...batches[0], changes }])
					: [],
		});
		return result;
	}

	getSyncState(peerId: string) {
		return getSyncState(this.database, peerId);
	}

	updateSyncCursor(peerId: string, cursor: string) {
		return updateSyncCursor(this.database, peerId, cursor);
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
