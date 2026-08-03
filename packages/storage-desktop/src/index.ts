import type {
	ApplyResult,
	DomainCommand,
	DomainQuery,
	WorkspaceChangeListener,
	WorkspaceRepository,
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
	#listeners = new Set<WorkspaceChangeListener>();
	#localListeners = new Set<WorkspaceChangeListener>();

	constructor(
		private readonly workspaceId: string,
		private readonly invoke: DesktopInvoke,
		private readonly listen?: (
			event: string,
			listener: () => void,
		) => Promise<() => void>,
	) {
		if (!workspaceId) throw new Error("workspaceId is required");
	}

	/**
	 * Listens for another local writer — today the agent bridge — changing this
	 * workspace's SQLite. That is this device changing its own store, exactly
	 * like a write from the renderer, so it fires the local listeners too and
	 * the change is pushed rather than waiting for the next sync poll. A native
	 * remote-apply path that needs a repaint without a push must emit a distinct
	 * event rather than overloading this one.
	 */
	async connect(): Promise<() => void> {
		if (!this.listen) return () => undefined;
		return this.listen("contextboard://workspace-changed", () => {
			for (const listener of this.#listeners) listener();
			for (const listener of this.#localListeners) listener();
		});
	}

	query<T>(query: DomainQuery<T>): Promise<T> {
		return this.invoke<T>("workspace_query", {
			workspaceId: this.workspaceId,
			query,
		});
	}

	async execute<T>(command: DomainCommand<T>): Promise<T> {
		const result = await this.invoke<T>("workspace_execute", {
			workspaceId: this.workspaceId,
			command,
		});
		for (const listener of this.#listeners) listener();
		for (const listener of this.#localListeners) listener();
		return result;
	}

	subscribe(listener: WorkspaceChangeListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
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

	getPendingBatches(limit: number): Promise<ChangeBatch[]> {
		return this.invoke("workspace_pending_batches", {
			workspaceId: this.workspaceId,
			limit,
		});
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
		// Remote writes must repaint the UI too, otherwise a pulled change sits
		// in SQLite until the next local edit.
		for (const listener of this.#listeners) listener();
		return result;
	}

	getSyncState(peerId: string): Promise<PersistedSyncState> {
		return this.invoke("workspace_sync_state", {
			workspaceId: this.workspaceId,
			peerId,
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
