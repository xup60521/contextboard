import entityManifest from "./entity-manifest.json" with { type: "json" };

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_SCHEMA_VERSION = 2 as const;
/** Maximum sync JSON request body accepted by the public gateway. */
export const MAX_SYNC_JSON_BODY_BYTES = 8 * 1024 * 1024;
/**
 * Leave room for the push envelope, cursor and future protocol fields. Local
 * writers use this limit before committing an atomic pending batch.
 */
export const MAX_SYNC_BATCH_BYTES = MAX_SYNC_JSON_BODY_BYTES - 4 * 1024;
export const ENTITY_MANIFEST = entityManifest;
export type SyncCapability = "card-content-v1";

function hash32(value: string, seed: number): string {
	let hash = seed;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function deterministicEntityId(
	namespace: string,
	...parts: string[]
): string {
	const value = parts.map((part) => `${part.length}:${part}`).join("|");
	const digest = [
		hash32(value, 0x811c9dc5),
		hash32(value, 0x9e3779b9),
		hash32(value, 0x85ebca6b),
		hash32(value, 0xc2b2ae35),
	].join("");
	return `${namespace}:${digest}`;
}

export function conflictCopyCardId(conflictId: string): string {
	return deterministicEntityId("conflict-card", conflictId);
}

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

export type SyncEntityType = keyof typeof entityManifest.entities;

export type EntityChange = {
	entityType: SyncEntityType;
	entityId: string;
	baseRevision: number | null;
	revision: number;
	operation: "upsert" | "delete";
	clock: string;
	value: unknown;
};

export type ChangeBatch = {
	protocolVersion: typeof SYNC_PROTOCOL_VERSION;
	schemaVersion: typeof SYNC_SCHEMA_VERSION;
	changeId: string;
	workspaceId: string;
	deviceId: string;
	deviceSequence: number;
	clock: string;
	command: string;
	createdAt: number;
	changes: EntityChange[];
};

export type SyncCursor = string;
export type BlobDescriptor = {
	hash: string;
	contentType: string;
	size: number;
};
export type SyncEnvelope<T> = {
	protocolVersion: typeof SYNC_PROTOCOL_VERSION;
	schemaVersion: typeof SYNC_SCHEMA_VERSION;
	encryption: "none";
	payload: T;
};
export type PushChangesRequest = {
	workspaceId: string;
	batches: ChangeBatch[];
	cursor: SyncCursor | null;
	capabilities?: readonly SyncCapability[];
};
export type PushChangesResponse = {
	cursor: SyncCursor;
	acknowledgedChangeIds: string[];
	missingBlobHashes: string[];
};
export type PullChangesRequest = {
	workspaceId: string;
	cursor: SyncCursor | null;
	limit: number;
	capabilities?: readonly SyncCapability[];
};
export type PullChangesResponse = {
	cursor: SyncCursor;
	batches: ChangeBatch[];
	hasMore: boolean;
};
export type SyncResult = {
	pushed: number;
	pulled: number;
	conflicts: number;
	cursor: SyncCursor | null;
};
export type SyncStatus = {
	state: "local-only" | "idle" | "syncing" | "error";
	cursor: SyncCursor | null;
	error?: string;
};
export type ConflictRecord = {
	conflictId: string;
	entityType: SyncEntityType;
	entityId: string;
	localValue: unknown;
	remoteValue: unknown;
	createdAt: number;
	resolvedAt: number | null;
	resolution: "keep-local" | "keep-remote" | "keep-both" | null;
	revision: number;
	updatedAt: number;
	updatedByDeviceId: string;
};
export type CheckpointDescriptor = {
	checkpointId: string;
	workspaceId: string;
	coveredCursor: SyncCursor;
	blob: BlobDescriptor;
	createdAt: number;
};

export type WorkspaceMembership = {
	workspaceId: string;
	role: "owner" | "member";
	createdAt: number;
	isDefault: boolean;
};

export type WorkspaceRedirect = {
	fromWorkspaceId: string;
	toWorkspaceId: string;
	mergedAt: number;
};

export type ListWorkspacesResponse = {
	workspaces: WorkspaceMembership[];
	redirects: WorkspaceRedirect[];
};

export type SelectWorkspaceRequest = {
	workspaceId: string;
};

export type ClaimWorkspaceRequest = {
	workspaceId: string;
	deviceId: string;
};

export type ClaimWorkspaceResponse = WorkspaceMembership & {
	claimed: boolean;
};

export type PersistedSyncState = {
	peerId: string;
	cursor: SyncCursor | null;
	enabled: boolean;
	updatedAt: number;
	lastSyncedAt: number | null;
	lastAckAt: number | null;
};

export type WorkspaceCheckpoint = {
	workspaceId: string;
	coveredCursor: SyncCursor;
	createdAt: number;
	entities: Record<string, unknown[]>;
};

export class SyncProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SyncProtocolError";
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readId = (value: unknown, name: string) => {
	if (
		typeof value !== "string" ||
		value.length < 1 ||
		value.length > 256 ||
		!/^[A-Za-z0-9:._-]+$/.test(value)
	)
		throw new SyncProtocolError(`${name} is invalid`);
	return value;
};

export const SYNC_VERSION_HEADERS = {
	protocol: "x-contextboard-protocol-version",
	schema: "x-contextboard-schema-version",
} as const;

export function syncVersionHeaders(): Record<string, string> {
	return {
		[SYNC_VERSION_HEADERS.protocol]: String(SYNC_PROTOCOL_VERSION),
		[SYNC_VERSION_HEADERS.schema]: String(SYNC_SCHEMA_VERSION),
	};
}

export function parseSyncVersionHeaders(
	value: Headers | Record<string, string | undefined>,
) {
	const read = (name: string) =>
		value instanceof Headers ? value.get(name) : value[name];
	const protocolVersion = read(SYNC_VERSION_HEADERS.protocol);
	const schemaVersion = read(SYNC_VERSION_HEADERS.schema);
	readVersion(
		protocolVersion === null || protocolVersion === undefined
			? undefined
			: Number(protocolVersion),
		SYNC_PROTOCOL_VERSION,
		"protocol version",
	);
	readVersion(
		schemaVersion === null || schemaVersion === undefined
			? undefined
			: Number(schemaVersion),
		SYNC_SCHEMA_VERSION,
		"schema version",
	);
	return {
		protocolVersion: SYNC_PROTOCOL_VERSION,
		schemaVersion: SYNC_SCHEMA_VERSION,
	};
}

export function parseWorkspaceId(value: unknown) {
	return readId(value, "workspaceId");
}

export function parseDeviceId(value: unknown) {
	return readId(value, "deviceId");
}

export function parseBlobHash(value: unknown) {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
		throw new SyncProtocolError("hash is invalid");
	return value;
}

export function parseSyncCursor(value: unknown): SyncCursor | null {
	if (value === null) return null;
	if (
		typeof value !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(value) ||
		!Number.isSafeInteger(Number(value))
	)
		throw new SyncProtocolError("cursor is invalid");
	return value;
}

export function parsePaginationLimit(value: unknown) {
	const parsed =
		typeof value === "string" && value !== "" ? Number(value) : value;
	if (
		!Number.isSafeInteger(parsed) ||
		Number(parsed) < 1 ||
		Number(parsed) > 1000
	)
		throw new SyncProtocolError("limit is invalid");
	return Number(parsed);
}

export function parseBlobDescriptor(value: unknown): BlobDescriptor {
	if (!isRecord(value))
		throw new SyncProtocolError("Blob descriptor must be an object");
	if (
		typeof value.contentType !== "string" ||
		value.contentType.length < 1 ||
		value.contentType.length > 255 ||
		!Number.isSafeInteger(value.size) ||
		Number(value.size) < 0
	)
		throw new SyncProtocolError("Blob descriptor is invalid");
	return {
		hash: parseBlobHash(value.hash),
		contentType: value.contentType,
		size: Number(value.size),
	};
}

export function parseBlobRequestHeaders(
	value: Headers | Record<string, string | undefined>,
) {
	const read = (name: string) =>
		value instanceof Headers ? value.get(name) : value[name];
	const contentLength = read("x-contextboard-blob-size");
	const size =
		contentLength === null || contentLength === undefined
			? Number.NaN
			: Number(contentLength);
	return {
		workspaceId: parseWorkspaceId(read("x-contextboard-workspace")),
		contentType: (() => {
			const contentType = read("content-type");
			if (
				typeof contentType !== "string" ||
				contentType.length < 1 ||
				contentType.length > 255
			)
				throw new SyncProtocolError("content-type is invalid");
			return contentType;
		})(),
		size: (() => {
			if (!Number.isSafeInteger(size) || size < 0)
				throw new SyncProtocolError("blob size is invalid");
			return size;
		})(),
	};
}

const readVersion = (
	value: unknown,
	expected: number,
	name: string,
): number => {
	if (value !== expected)
		throw new SyncProtocolError(`Unsupported ${name}: ${String(value)}`);
	return expected;
};

export function parseChangeBatch(value: unknown): ChangeBatch {
	if (!isRecord(value)) throw new SyncProtocolError("Batch must be an object");
	readVersion(value.protocolVersion, SYNC_PROTOCOL_VERSION, "protocol version");
	readVersion(value.schemaVersion, SYNC_SCHEMA_VERSION, "schema version");
	const changes = value.changes;
	if (!Array.isArray(changes) || changes.length > 10_000)
		throw new SyncProtocolError("Batch changes are invalid");
	const parsedChanges = changes.map((change, index): EntityChange => {
		if (!isRecord(change))
			throw new SyncProtocolError(`Change ${index} must be an object`);
		const entityType = change.entityType;
		if (!(String(entityType) in ENTITY_MANIFEST.entities))
			throw new SyncProtocolError(`Change ${index} has an invalid entity type`);
		if (change.operation !== "upsert" && change.operation !== "delete")
			throw new SyncProtocolError(`Change ${index} has an invalid operation`);
		if (
			(change.baseRevision !== null &&
				(!Number.isSafeInteger(change.baseRevision) ||
					Number(change.baseRevision) < 0)) ||
			!Number.isSafeInteger(change.revision) ||
			Number(change.revision) < 1
		)
			throw new SyncProtocolError(`Change ${index} has an invalid revision`);
		return {
			entityType: entityType as SyncEntityType,
			entityId: readId(change.entityId, `changes[${index}].entityId`),
			baseRevision: change.baseRevision as number | null,
			revision: Number(change.revision),
			operation: change.operation,
			clock: readId(change.clock, `changes[${index}].clock`),
			value: change.value,
		};
	});
	if (
		!Number.isSafeInteger(value.deviceSequence) ||
		Number(value.deviceSequence) < 1 ||
		!Number.isFinite(value.createdAt)
	)
		throw new SyncProtocolError("Batch sequence or timestamp is invalid");
	return {
		protocolVersion: SYNC_PROTOCOL_VERSION,
		schemaVersion: SYNC_SCHEMA_VERSION,
		changeId: readId(value.changeId, "changeId"),
		workspaceId: readId(value.workspaceId, "workspaceId"),
		deviceId: readId(value.deviceId, "deviceId"),
		deviceSequence: Number(value.deviceSequence),
		clock: readId(value.clock, "clock"),
		command: readId(value.command, "command"),
		createdAt: Number(value.createdAt),
		changes: parsedChanges,
	};
}

export function parsePushChangesRequest(value: unknown): PushChangesRequest {
	if (!isRecord(value))
		throw new SyncProtocolError("Request must be an object");
	const workspaceId = readId(value.workspaceId, "workspaceId");
	if (!Array.isArray(value.batches) || value.batches.length > 500)
		throw new SyncProtocolError("batches is invalid");
	const batches = value.batches.map(parseChangeBatch);
	if (batches.some((batch) => batch.workspaceId !== workspaceId))
		throw new SyncProtocolError("Workspace mismatch");
	return {
		workspaceId,
		batches,
		cursor: parseSyncCursor(value.cursor),
		capabilities: parseCapabilities(value.capabilities),
	};
}

export function parsePullChangesRequest(value: unknown): PullChangesRequest {
	if (!isRecord(value))
		throw new SyncProtocolError("Request must be an object");
	return {
		workspaceId: parseWorkspaceId(value.workspaceId),
		cursor: parseSyncCursor(value.cursor),
		limit: parsePaginationLimit(value.limit),
		capabilities: parseCapabilities(value.capabilities),
	};
}

function parseCapabilities(value: unknown): readonly SyncCapability[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 16)
		throw new SyncProtocolError("capabilities is invalid");
	const supported: SyncCapability[] = ["card-content-v1"];
	if (value.some((entry) => !supported.includes(entry as SyncCapability)))
		throw new SyncProtocolError("capabilities contains an unsupported value");
	return [...new Set(value as SyncCapability[])];
}

export function parseClaimWorkspaceRequest(
	value: unknown,
): ClaimWorkspaceRequest {
	if (!isRecord(value))
		throw new SyncProtocolError("Request must be an object");
	return {
		workspaceId: parseWorkspaceId(value.workspaceId),
		deviceId: parseDeviceId(value.deviceId),
	};
}

export function parseSelectWorkspaceRequest(
	value: unknown,
): SelectWorkspaceRequest {
	if (!isRecord(value))
		throw new SyncProtocolError("Request must be an object");
	return { workspaceId: parseWorkspaceId(value.workspaceId) };
}

export function parseCheckpointDescriptor(
	value: unknown,
): CheckpointDescriptor {
	if (!isRecord(value))
		throw new SyncProtocolError("Checkpoint descriptor must be an object");
	if (!Number.isFinite(value.createdAt) || Number(value.createdAt) < 0)
		throw new SyncProtocolError("Checkpoint timestamp is invalid");
	const coveredCursor = parseSyncCursor(value.coveredCursor);
	if (coveredCursor === null)
		throw new SyncProtocolError("Checkpoint cursor is invalid");
	return {
		checkpointId: readId(value.checkpointId, "checkpointId"),
		workspaceId: parseWorkspaceId(value.workspaceId),
		coveredCursor,
		blob: parseBlobDescriptor(value.blob),
		createdAt: Number(value.createdAt),
	};
}

export interface SyncTransport {
	push(
		request: PushChangesRequest,
		signal?: AbortSignal,
	): Promise<PushChangesResponse>;
	pull(
		request: PullChangesRequest,
		signal?: AbortSignal,
	): Promise<PullChangesResponse>;
	uploadBlob?(
		workspaceId: string,
		descriptor: BlobDescriptor,
		blob: Blob,
		signal?: AbortSignal,
	): Promise<void>;
	downloadBlob?(
		workspaceId: string,
		descriptor: BlobDescriptor,
		signal?: AbortSignal,
	): Promise<Blob>;
}

export class LocalOnlyTransport implements SyncTransport {
	async push(
		_request: PushChangesRequest,
		_signal?: AbortSignal,
	): Promise<PushChangesResponse> {
		throw new Error("Synchronization is not configured");
	}
	async pull(
		_request: PullChangesRequest,
		_signal?: AbortSignal,
	): Promise<PullChangesResponse> {
		throw new Error("Synchronization is not configured");
	}
}

export class HybridLogicalClock {
	#millis = 0;
	#counter = 0;
	constructor(private readonly deviceId: string) {}

	tick(now = Date.now()): string {
		if (now > this.#millis) {
			this.#millis = now;
			this.#counter = 0;
		} else this.#counter += 1;
		return `${this.#millis.toString().padStart(13, "0")}:${this.#counter.toString().padStart(6, "0")}:${this.deviceId}`;
	}

	observe(remote: string, now = Date.now()): string {
		const [millis = "0", counter = "0"] = remote.split(":");
		const remoteMillis = Number(millis);
		const remoteCounter = Number(counter);
		const nextMillis = Math.max(now, this.#millis, remoteMillis);
		this.#counter =
			nextMillis === this.#millis && nextMillis === remoteMillis
				? Math.max(this.#counter, remoteCounter) + 1
				: nextMillis === this.#millis
					? this.#counter + 1
					: nextMillis === remoteMillis
						? remoteCounter + 1
						: 0;
		this.#millis = nextMillis;
		return `${this.#millis.toString().padStart(13, "0")}:${this.#counter.toString().padStart(6, "0")}:${this.deviceId}`;
	}
}
