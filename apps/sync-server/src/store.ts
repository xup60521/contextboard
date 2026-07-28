import { Database } from "bun:sqlite";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	BlobDescriptor,
	ChangeBatch,
	CheckpointDescriptor,
	PullChangesResponse,
	PushChangesResponse,
} from "@contextboard/sync-protocol";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  workspace_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, device_id)
);
CREATE TABLE IF NOT EXISTS change_batches (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_sequence INTEGER NOT NULL,
  clock TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, device_id, device_sequence)
);
CREATE INDEX IF NOT EXISTS change_batches_workspace_cursor
  ON change_batches(workspace_id, cursor);
CREATE TABLE IF NOT EXISTS blobs (
  workspace_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, hash)
);
CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  covered_cursor INTEGER NOT NULL,
  blob_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checkpoints_workspace_cursor
  ON checkpoints(workspace_id, covered_cursor DESC);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
`;

const cursorNumber = (cursor: string | null) => {
	if (cursor === null) return 0;
	const value = Number(cursor);
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error("Invalid cursor");
	return value;
};

export class SyncStore {
	readonly db: Database;
	readonly blobRoot: string;

	constructor(databasePath: string, blobRoot: string) {
		if (databasePath !== ":memory:")
			mkdirSync(dirname(databasePath), { recursive: true });
		mkdirSync(blobRoot, { recursive: true });
		this.db = new Database(databasePath, { create: true, strict: true });
		this.blobRoot = blobRoot;
		this.db.exec(SCHEMA);
		const memberColumns = this.db
			.query("PRAGMA table_info(workspace_members)")
			.all() as Array<{ name: string }>;
		if (!memberColumns.some((column) => column.name === "created_at")) {
			this.db.exec(
				"ALTER TABLE workspace_members ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
			);
		}
	}

	close() {
		this.db.close();
	}

	push(workspaceId: string, batches: ChangeBatch[]): PushChangesResponse {
		const acknowledgedChangeIds: string[] = [];
		const missing = new Set<string>();
		const insertWorkspace = this.db.prepare(
			"INSERT OR IGNORE INTO workspaces(id, created_at) VALUES (?, ?)",
		);
		const findByChangeId = this.db.prepare(
			"SELECT cursor, change_id, workspace_id, device_id, device_sequence FROM change_batches WHERE change_id = ?",
		);
		const findBySequence = this.db.prepare(
			"SELECT cursor, change_id FROM change_batches WHERE workspace_id = ? AND device_id = ? AND device_sequence = ?",
		);
		const insert = this.db.prepare(
			`INSERT INTO change_batches
       (change_id, workspace_id, device_id, device_sequence, clock, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		const upsertDevice = this.db.prepare(
			`INSERT INTO devices(workspace_id, device_id, last_sequence) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, device_id) DO UPDATE
       SET last_sequence = MAX(last_sequence, excluded.last_sequence)`,
		);
		const hasBlob = this.db.prepare(
			"SELECT 1 FROM blobs WHERE workspace_id = ? AND hash = ?",
		);
		this.db.transaction(() => {
			insertWorkspace.run(workspaceId, Date.now());
			for (const batch of batches) {
				if (batch.workspaceId !== workspaceId)
					throw new Error("Workspace mismatch");
				const byId = findByChangeId.get(batch.changeId) as {
					workspace_id: string;
					device_id: string;
					device_sequence: number;
				} | null;
				if (
					byId &&
					(byId.workspace_id !== workspaceId ||
						byId.device_id !== batch.deviceId ||
						byId.device_sequence !== batch.deviceSequence)
				)
					throw new SequenceConflictError(
						"changeId is already assigned to a different device sequence",
					);
				const bySequence = findBySequence.get(
					workspaceId,
					batch.deviceId,
					batch.deviceSequence,
				) as { change_id: string } | null;
				if (bySequence && bySequence.change_id !== batch.changeId)
					throw new SequenceConflictError(
						"Device sequence is already assigned to a different changeId",
					);
				const existing = byId ?? bySequence;
				if (!existing) {
					insert.run(
						batch.changeId,
						workspaceId,
						batch.deviceId,
						batch.deviceSequence,
						batch.clock,
						JSON.stringify(batch),
						batch.createdAt,
					);
					upsertDevice.run(workspaceId, batch.deviceId, batch.deviceSequence);
				}
				acknowledgedChangeIds.push(batch.changeId);
				for (const change of batch.changes) {
					const value = change.value as { hash?: unknown } | null;
					if (
						value &&
						typeof value.hash === "string" &&
						!hasBlob.get(workspaceId, value.hash)
					)
						missing.add(value.hash);
				}
			}
		})();
		const row = this.db
			.prepare(
				"SELECT COALESCE(MAX(cursor), 0) cursor FROM change_batches WHERE workspace_id = ?",
			)
			.get(workspaceId) as { cursor: number };
		return {
			cursor: String(row.cursor),
			acknowledgedChangeIds,
			missingBlobHashes: [...missing],
		};
	}

	pull(
		workspaceId: string,
		cursor: string | null,
		limit: number,
	): PullChangesResponse {
		const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
		const rows = this.db
			.prepare(
				`SELECT cursor, payload FROM change_batches
         WHERE workspace_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`,
			)
			.all(workspaceId, cursorNumber(cursor), safeLimit + 1) as Array<{
			cursor: number;
			payload: string;
		}>;
		const hasMore = rows.length > safeLimit;
		const page = rows.slice(0, safeLimit);
		return {
			cursor: String(page.at(-1)?.cursor ?? cursorNumber(cursor)),
			batches: page.map((row) => JSON.parse(row.payload) as ChangeBatch),
			hasMore,
		};
	}

	blobPath(workspaceId: string, hash: string) {
		if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid SHA-256 hash");
		return join(this.blobRoot, workspaceId, hash);
	}

	async putBlob(
		workspaceId: string,
		descriptor: BlobDescriptor,
		body: ReadableStream<Uint8Array>,
	) {
		const path = this.blobPath(workspaceId, descriptor.hash);
		const existing = this.db
			.prepare(
				"SELECT content_type contentType, size FROM blobs WHERE workspace_id = ? AND hash = ?",
			)
			.get(workspaceId, descriptor.hash) as {
			contentType: string;
			size: number;
		} | null;
		if (existing && (await Bun.file(path).exists())) {
			if (existing.size !== descriptor.size)
				throw new Error("Existing blob size does not match descriptor");
			return;
		}
		mkdirSync(dirname(path), { recursive: true });
		const temporary = `${path}.${crypto.randomUUID()}.upload`;
		const sink = Bun.file(temporary).writer();
		const hasher = new Bun.CryptoHasher("sha256");
		const reader = body.getReader();
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > descriptor.size)
					throw new Error("Blob exceeds declared size");
				hasher.update(value);
				sink.write(value);
			}
			await sink.end();
			if (
				size !== descriptor.size ||
				hasher.digest("hex") !== descriptor.hash
			) {
				await Bun.file(temporary).delete();
				throw new Error("Blob hash or size mismatch");
			}
			renameSync(temporary, path);
			this.db
				.prepare(
					`INSERT OR IGNORE INTO blobs(workspace_id, hash, content_type, size, created_at)
           VALUES (?, ?, ?, ?, ?)`,
				)
				.run(
					workspaceId,
					descriptor.hash,
					descriptor.contentType,
					size,
					Date.now(),
				);
		} catch (error) {
			await Promise.resolve(sink.end()).catch(() => undefined);
			await Promise.resolve(Bun.file(temporary).delete()).catch(
				() => undefined,
			);
			throw error;
		}
	}

	getBlobDescriptor(workspaceId: string, hash: string): BlobDescriptor | null {
		const row = this.db
			.prepare(
				`SELECT hash, content_type contentType, size FROM blobs
				 WHERE workspace_id = ? AND hash = ?`,
			)
			.get(workspaceId, hash) as BlobDescriptor | null;
		return row ?? null;
	}

	addCheckpoint(checkpoint: CheckpointDescriptor) {
		const blob = this.db
			.prepare("SELECT 1 FROM blobs WHERE workspace_id = ? AND hash = ?")
			.get(checkpoint.workspaceId, checkpoint.blob.hash);
		if (!blob) throw new Error("Checkpoint blob is missing");
		this.db
			.prepare(
				`INSERT OR IGNORE INTO checkpoints
         (checkpoint_id, workspace_id, covered_cursor, blob_hash, content_type, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				checkpoint.checkpointId,
				checkpoint.workspaceId,
				cursorNumber(checkpoint.coveredCursor),
				checkpoint.blob.hash,
				checkpoint.blob.contentType,
				checkpoint.blob.size,
				checkpoint.createdAt,
			);
	}

	latestCheckpoint(workspaceId: string): CheckpointDescriptor | null {
		const row = this.db
			.prepare(
				`SELECT checkpoint_id, covered_cursor, blob_hash, content_type, size, created_at
         FROM checkpoints WHERE workspace_id = ?
         ORDER BY covered_cursor DESC, created_at DESC LIMIT 1`,
			)
			.get(workspaceId) as {
			checkpoint_id: string;
			covered_cursor: number;
			blob_hash: string;
			content_type: string;
			size: number;
			created_at: number;
		} | null;
		return row
			? {
					checkpointId: row.checkpoint_id,
					workspaceId,
					coveredCursor: String(row.covered_cursor),
					blob: {
						hash: row.blob_hash,
						contentType: row.content_type,
						size: row.size,
					},
					createdAt: row.created_at,
				}
			: null;
	}

	isWorkspaceMember(workspaceId: string, userId: string) {
		return Boolean(
			this.db
				.prepare(
					"SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
				)
				.get(workspaceId, userId),
		);
	}

	listWorkspaces(userId: string) {
		return this.db
			.prepare(
				`SELECT workspace_id workspaceId, role, created_at createdAt
				 FROM workspace_members WHERE user_id = ?
				 ORDER BY created_at, workspace_id`,
			)
			.all(userId) as Array<{
			workspaceId: string;
			role: "owner" | "member";
			createdAt: number;
		}>;
	}

	claimWorkspace(workspaceId: string, deviceId: string, userId: string) {
		return this.db.transaction(() => {
			const membership = this.db
				.prepare(
					`SELECT role, created_at createdAt FROM workspace_members
					 WHERE workspace_id = ? AND user_id = ?`,
				)
				.get(workspaceId, userId) as {
				role: "owner" | "member";
				createdAt: number;
			} | null;
			if (membership) {
				this.db
					.prepare(
						`INSERT OR IGNORE INTO devices(workspace_id, device_id, last_sequence)
						 VALUES (?, ?, 0)`,
					)
					.run(workspaceId, deviceId);
				return {
					workspaceId,
					role: membership.role,
					createdAt: membership.createdAt,
					claimed: false,
				};
			}
			const workspace = this.db
				.prepare("SELECT 1 FROM workspaces WHERE id = ?")
				.get(workspaceId);
			if (workspace)
				throw new WorkspaceClaimConflictError(
					"Workspace already belongs to another account",
				);
			const createdAt = Date.now();
			this.db
				.prepare("INSERT INTO workspaces(id, created_at) VALUES (?, ?)")
				.run(workspaceId, createdAt);
			this.db
				.prepare(
					`INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
					 VALUES (?, ?, 'owner', ?)`,
				)
				.run(workspaceId, userId, createdAt);
			this.db
				.prepare(
					`INSERT INTO devices(workspace_id, device_id, last_sequence)
					 VALUES (?, ?, 0)`,
				)
				.run(workspaceId, deviceId);
			return {
				workspaceId,
				role: "owner" as const,
				createdAt,
				claimed: true,
			};
		})();
	}
}

export class SequenceConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SequenceConflictError";
	}
}

export class WorkspaceClaimConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceClaimConflictError";
	}
}
