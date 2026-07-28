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

	async connect(): Promise<() => void> {
		if (!this.listen) return () => undefined;
		return this.listen("contextboard://workspace-changed", () => {
			for (const listener of this.#listeners) listener();
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
		return result;
	}

	subscribe(listener: WorkspaceChangeListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
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

	applyRemote(
		batches: ChangeBatch[],
		peerId: string,
		nextCursor: string,
	): Promise<ApplyResult> {
		return this.invoke("workspace_apply_remote", {
			workspaceId: this.workspaceId,
			batches,
			peerId,
			nextCursor,
		});
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

	async storeRemoteBlob(
		descriptor: BlobDescriptor,
		blob: Blob,
	): Promise<void> {
		await this.invoke("workspace_store_blob", {
			workspaceId: this.workspaceId,
			descriptor,
			bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
		});
	}
}
