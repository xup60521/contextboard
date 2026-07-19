export const SYNC_PROTOCOL_VERSION = 1 as const;

export type WorkspaceIdentity = {
  workspaceId: string;
  createdAt: number;
  archiveFormatVersion: number;
};

export type DeviceIdentity = {
  deviceId: string;
  createdAt: number;
  displayName: string;
};

export type SyncEntityType =
  | "whiteboard" | "card" | "boardItem" | "tldrawDocument"
  | "file" | "fileReference" | "cardReference" | "todo";

export type EntityChange = {
  entityType: SyncEntityType;
  entityId: string;
  baseRevision: number | null;
  revision: number;
  operation: "upsert" | "delete";
  changedFields: string[];
  value: unknown;
};

export type ChangeBatch = {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  changeId: string;
  workspaceId: string;
  deviceId: string;
  sequence: number;
  clock: string;
  command: string;
  createdAt: number;
  changes: EntityChange[];
};

export type SyncCursor = string;
export type BlobDescriptor = { sha256: string; contentType: string; size: number };
export type PushChangesRequest = { workspaceId: string; batches: ChangeBatch[]; cursor: SyncCursor | null };
export type PushChangesResponse = { cursor: SyncCursor; acknowledgedChangeIds: string[]; missingBlobs: string[] };
export type PullChangesRequest = { workspaceId: string; cursor: SyncCursor | null; limit: number };
export type PullChangesResponse = { cursor: SyncCursor; batches: ChangeBatch[]; hasMore: boolean };
export type SyncResult = { pushed: number; pulled: number; conflicts: number; cursor: SyncCursor | null };
export type SyncStatus = { state: "local-only" | "idle" | "syncing" | "error"; cursor: SyncCursor | null; error?: string };
export type ConflictRecord = { conflictId: string; entityType: SyncEntityType; entityId: string; localValue: unknown; remoteValue: unknown; createdAt: number; resolvedAt: number | null };

export interface SyncTransport {
  push(request: PushChangesRequest, signal?: AbortSignal): Promise<PushChangesResponse>;
  pull(request: PullChangesRequest, signal?: AbortSignal): Promise<PullChangesResponse>;
  uploadBlob?(workspaceId: string, descriptor: BlobDescriptor, blob: Blob, signal?: AbortSignal): Promise<void>;
  downloadBlob?(workspaceId: string, descriptor: BlobDescriptor, signal?: AbortSignal): Promise<Blob>;
}

export class LocalOnlyTransport implements SyncTransport {
  async push(_request: PushChangesRequest, _signal?: AbortSignal): Promise<PushChangesResponse> { throw new Error("Synchronization is not configured"); }
  async pull(_request: PullChangesRequest, _signal?: AbortSignal): Promise<PullChangesResponse> { throw new Error("Synchronization is not configured"); }
}

export class HybridLogicalClock {
  #millis = 0;
  #counter = 0;
  constructor(private readonly deviceId: string) {}

  tick(now = Date.now()): string {
    if (now > this.#millis) { this.#millis = now; this.#counter = 0; }
    else this.#counter += 1;
    return `${this.#millis.toString().padStart(13, "0")}:${this.#counter.toString().padStart(6, "0")}:${this.deviceId}`;
  }
}
