import {
	type ApplyResult,
	type DomainCommand,
	type DomainQuery,
	describeDomainCommand,
	describeRemoteChanges,
	recordContextboardPerf,
	type WorkspaceChange,
	type WorkspaceChangeFilter,
	type WorkspaceChangeListener,
	type WorkspaceRepository,
	workspaceChangeMatches,
} from "@contextboard/client-core";
import type {
	BlobDescriptor,
	ChangeBatch,
	PersistedSyncState,
} from "@contextboard/sync-protocol";

export type DesktopInvoke = <T>(
	command: string,
	args?: Record<string, unknown>,
) => Promise<T>;

type DesktopBlob = {
	descriptor: BlobDescriptor;
	bytes: number[];
};

/**
 * Narrow Tauri IPC adapter. The renderer can issue semantic domain commands,
 * but it cannot submit SQL or arbitrary filesystem paths.
 */
export class DesktopWorkspaceRepository implements WorkspaceRepository {
	#listeners = new Set<{
		listener: WorkspaceChangeListener;
		filter?: WorkspaceChangeFilter;
	}>();
	#localListeners = new Set<WorkspaceChangeListener>();

	constructor(
		private readonly workspaceId: string,
		private readonly invoke: DesktopInvoke,
		private readonly listen?: (
			event: string,
			listener: (payload: unknown) => void,
		) => Promise<() => void>,
	) {
		if (!workspaceId) throw new Error("workspaceId is required");
	}

	/**
	 * Listens for another local writer changing this
	 * workspace's SQLite. That is this device changing its own store, exactly
	 * like a write from the renderer, so it fires the local listeners too and
	 * the change is pushed rather than waiting for the next sync poll. A native
	 * remote-apply path that needs a repaint without a push must emit a distinct
	 * event rather than overloading this one.
	 */
	async connect(): Promise<() => void> {
		if (!this.listen) return () => undefined;
		return this.listen("contextboard://workspace-changed", (payload) => {
			if (!isWorkspaceChange(payload)) return;
			const change = payload;
			this.#emit(change);
			if (change.origin === "local" && change.changes.length > 0)
				for (const listener of this.#localListeners) listener(change);
		});
	}

	async query<T>(query: DomainQuery<T>): Promise<T> {
		recordContextboardPerf("repository.query", { detail: query.type });
		const result = await this.invoke<T>("workspace_query", {
			workspaceId: this.workspaceId,
			query,
		});
		if (Array.isArray(result))
			recordContextboardPerf("repository.rows", {
				detail: query.type,
				value: result.length,
			});
		return result;
	}

	async execute<T>(command: DomainCommand<T>): Promise<T> {
		recordContextboardPerf("repository.command", { detail: command.type });
		const result = await this.invoke<T>("workspace_execute", {
			workspaceId: this.workspaceId,
			command,
		});
		const change: WorkspaceChange = {
			origin: "local",
			changes: describeDomainCommand(command, result),
		};
		this.#emit(change);
		if (change.changes.length > 0)
			for (const listener of this.#localListeners) listener(change);
		return result;
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
	): () => void {
		const subscription = { listener, filter };
		this.#listeners.add(subscription);
		return () => this.#listeners.delete(subscription);
	}

	/**
	 * Local writes only. Sync uses this to schedule a push without re-arming
	 * itself every time it applies a remote batch.
	 */
	subscribeLocal(listener: WorkspaceChangeListener): () => void {
		this.#localListeners.add(listener);
		return () => this.#localListeners.delete(listener);
	}

	/** Stable device identity used when claiming this workspace on the server. */
	deviceId(): Promise<string> {
		return this.invoke("workspace_device_id", {
			workspaceId: this.workspaceId,
		});
	}

	/** True when this device holds workspace data that must not be discarded. */
	hasData(): Promise<boolean> {
		return this.invoke("workspace_has_data", {
			workspaceId: this.workspaceId,
		});
	}

	/** Moves this device's workspace onto a server-issued workspace id. */
	async adopt(targetWorkspaceId: string): Promise<void> {
		await this.invoke("workspace_adopt", {
			workspaceId: this.workspaceId,
			targetWorkspaceId,
		});
	}

	async getPendingBatches(limit: number): Promise<ChangeBatch[]> {
		const batches = await this.invoke<ChangeBatch[]>(
			"workspace_pending_batches",
			{
				workspaceId: this.workspaceId,
				limit,
			},
		);
		recordContextboardPerf("repository.rows", {
			detail: "changeLog.pending",
			value: batches.length,
		});
		return batches;
	}

	acknowledge(changeIds: string[]): Promise<void> {
		return this.invoke("workspace_acknowledge", {
			workspaceId: this.workspaceId,
			changeIds,
		});
	}

	async applyRemote(
		batches: ChangeBatch[],
		peerId: string,
		nextCursor: string,
	): Promise<ApplyResult> {
		if (batches.some((batch) => batch.workspaceId !== this.workspaceId))
			throw new Error("Remote batch workspace does not match this device");
		const result = await this.invoke<ApplyResult>("workspace_apply_remote", {
			workspaceId: this.workspaceId,
			batches,
			peerId,
			nextCursor,
		});
		// Native storage reports only rows it actually materialized. This avoids
		// repainting on duplicate or stale remote batches.
		this.#emit({
			origin: "remote",
			changes: describeRemoteChanges(result.materializedChanges ?? []),
		});
		return result;
	}

	getSyncState(peerId: string): Promise<PersistedSyncState> {
		return this.invoke("workspace_sync_state", {
			workspaceId: this.workspaceId,
			peerId,
		});
	}

	updateSyncCursor(peerId: string, cursor: string): Promise<void> {
		return this.invoke("workspace_update_sync_cursor", {
			workspaceId: this.workspaceId,
			peerId,
			cursor,
		});
	}

	async getLocalBlob(hash: string) {
		const blob = await this.invoke<DesktopBlob | null>("workspace_read_blob", {
			workspaceId: this.workspaceId,
			hash,
		});
		if (!blob) return null;
		return {
			descriptor: blob.descriptor,
			blob: new Blob([Uint8Array.from(blob.bytes)], {
				type: blob.descriptor.contentType,
			}),
		};
	}

	getMissingBlobs(): Promise<BlobDescriptor[]> {
		return this.invoke("workspace_missing_blobs", {
			workspaceId: this.workspaceId,
		});
	}

	async storeRemoteBlob(descriptor: BlobDescriptor, blob: Blob): Promise<void> {
		await this.invoke("workspace_store_blob", {
			workspaceId: this.workspaceId,
			descriptor,
			bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
		});
	}
}

function isWorkspaceChange(value: unknown): value is WorkspaceChange {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<WorkspaceChange>;
	return (
		(candidate.origin === "local" || candidate.origin === "remote") &&
		Array.isArray(candidate.changes) &&
		candidate.changes.every(
			(change) =>
				!!change &&
				typeof change.entityType === "string" &&
				typeof change.entityId === "string" &&
				(change.operation === "upsert" || change.operation === "delete"),
		)
	);
}
