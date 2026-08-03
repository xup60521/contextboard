import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	BlobDescriptor,
	ChangeBatch,
	CheckpointDescriptor,
	PullChangesResponse,
	PushChangesResponse,
	WorkspaceRedirect,
} from "@contextboard/sync-protocol";
import {
	generateAgentToken,
	hashAgentToken,
	hashesMatch,
} from "./agent-tokens";

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
  change_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_sequence INTEGER NOT NULL,
  clock TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, change_id),
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
  is_default INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS workspace_redirects (
  from_workspace_id TEXT PRIMARY KEY,
  to_workspace_id TEXT NOT NULL,
  merged_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_tokens_user
  ON agent_tokens(user_id, created_at DESC);
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
		this.migrateChangeBatchConstraints();
		const memberColumns = this.db
			.query("PRAGMA table_info(workspace_members)")
			.all() as Array<{ name: string }>;
		if (!memberColumns.some((column) => column.name === "created_at")) {
			this.db.exec(
				"ALTER TABLE workspace_members ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
			);
		}
		if (!memberColumns.some((column) => column.name === "is_default")) {
			this.db.exec(
				"ALTER TABLE workspace_members ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0",
			);
		}
		this.db.exec(
			"CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_one_default_per_user ON workspace_members(user_id) WHERE is_default = 1",
		);
		this.backfillDefaultWorkspaces();
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
			"SELECT cursor, change_id, workspace_id, device_id, device_sequence FROM change_batches WHERE workspace_id = ? AND change_id = ?",
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
				const byId = findByChangeId.get(workspaceId, batch.changeId) as {
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
		let renamed = false;
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
			if (await Bun.file(path).exists()) await Bun.file(path).delete();
			renameSync(temporary, path);
			renamed = true;
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
			if (renamed)
				await Promise.resolve(Bun.file(path).delete()).catch(() => undefined);
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

	private backfillDefaultWorkspaces() {
		const users = this.db
			.query(
				"SELECT DISTINCT user_id FROM workspace_members WHERE is_default = 0",
			)
			.all() as Array<{ user_id: string }>;
		const choose = this.db.prepare(
			`SELECT workspace_id FROM workspace_members
			 WHERE user_id = ? ORDER BY created_at, workspace_id LIMIT 1`,
		);
		const mark = this.db.prepare(
			"UPDATE workspace_members SET is_default = 1 WHERE user_id = ? AND workspace_id = ?",
		);
		this.db.transaction(() => {
			for (const { user_id } of users) {
				const existing = this.db
					.prepare(
						"SELECT 1 FROM workspace_members WHERE user_id = ? AND is_default = 1 LIMIT 1",
					)
					.get(user_id);
				if (existing) continue;
				const first = choose.get(user_id) as { workspace_id: string } | null;
				if (first) mark.run(user_id, first.workspace_id);
			}
		})();
	}

	private migrateChangeBatchConstraints() {
		const indexes = this.db
			.query("PRAGMA index_list(change_batches)")
			.all() as Array<{ name: string; unique: number }>;
		const hasGlobalChangeIdIndex = indexes.some((index) => {
			if (!index.unique) return false;
			const columns = this.db
				.query(`PRAGMA index_info(${JSON.stringify(index.name)})`)
				.all() as Array<{ name: string }>;
			return columns.length === 1 && columns[0]?.name === "change_id";
		});
		if (!hasGlobalChangeIdIndex) return;
		this.db.exec(`
			BEGIN IMMEDIATE;
			CREATE TABLE change_batches_rebuilt (
			  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
			  change_id TEXT NOT NULL,
			  workspace_id TEXT NOT NULL,
			  device_id TEXT NOT NULL,
			  device_sequence INTEGER NOT NULL,
			  clock TEXT NOT NULL,
			  payload TEXT NOT NULL,
			  created_at INTEGER NOT NULL,
			  UNIQUE (workspace_id, change_id),
			  UNIQUE (workspace_id, device_id, device_sequence)
			);
			INSERT INTO change_batches_rebuilt
			  (cursor, change_id, workspace_id, device_id, device_sequence, clock, payload, created_at)
			SELECT cursor, change_id, workspace_id, device_id, device_sequence, clock, payload, created_at
			FROM change_batches ORDER BY cursor;
			DROP TABLE change_batches;
			ALTER TABLE change_batches_rebuilt RENAME TO change_batches;
			CREATE INDEX change_batches_workspace_cursor
			  ON change_batches(workspace_id, cursor);
			COMMIT;
		`);
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
		const workspaces = this.db
			.prepare(
				`SELECT workspace_id workspaceId, role, created_at createdAt,
						is_default isDefault
				 FROM workspace_members
				 WHERE user_id = ?
				   AND workspace_id NOT IN (
						SELECT from_workspace_id FROM workspace_redirects
					)
				 ORDER BY created_at, workspace_id`,
			)
			.all(userId) as Array<{
			workspaceId: string;
			role: "owner" | "member";
			createdAt: number;
			isDefault: number;
		}>;
		const redirects = this.db
			.prepare(
				`SELECT r.from_workspace_id fromWorkspaceId,
						r.to_workspace_id toWorkspaceId, r.merged_at mergedAt
				 FROM workspace_redirects r
				 JOIN workspace_members source
				   ON source.workspace_id = r.from_workspace_id AND source.user_id = ?
				 JOIN workspace_members target
				   ON target.workspace_id = r.to_workspace_id AND target.user_id = ?
				 ORDER BY r.merged_at, r.from_workspace_id`,
			)
			.all(userId, userId) as WorkspaceRedirect[];
		return {
			workspaces: workspaces.map((workspace) => ({
				...workspace,
				isDefault: Boolean(workspace.isDefault),
			})),
			redirects,
		};
	}

	getWorkspaceRedirect(workspaceId: string, userId: string) {
		return this.db
			.prepare(
				`SELECT r.from_workspace_id fromWorkspaceId,
						r.to_workspace_id toWorkspaceId, r.merged_at mergedAt
				 FROM workspace_redirects r
				 JOIN workspace_members source
				   ON source.workspace_id = r.from_workspace_id AND source.user_id = ?
				 JOIN workspace_members target
				   ON target.workspace_id = r.to_workspace_id AND target.user_id = ?
				 WHERE r.from_workspace_id = ?`,
			)
			.get(userId, userId, workspaceId) as WorkspaceRedirect | null;
	}

	selectDefaultWorkspace(workspaceId: string, userId: string) {
		return this.db.transaction(() => {
			const membership = this.db
				.prepare(
					`SELECT workspace_id workspaceId, role, created_at createdAt
					 FROM workspace_members WHERE workspace_id = ? AND user_id = ?`,
				)
				.get(workspaceId, userId) as {
				workspaceId: string;
				role: "owner" | "member";
				createdAt: number;
			} | null;
			if (!membership) throw new WorkspaceMembershipError("Forbidden");
			this.db
				.prepare(
					"UPDATE workspace_members SET is_default = 0 WHERE user_id = ?",
				)
				.run(userId);
			this.db
				.prepare(
					"UPDATE workspace_members SET is_default = 1 WHERE workspace_id = ? AND user_id = ?",
				)
				.run(workspaceId, userId);
			return { ...membership, isDefault: true };
		})();
	}

	claimWorkspace(workspaceId: string, deviceId: string, userId: string) {
		return this.db.transaction(() => {
			const membership = this.db
				.prepare(
					`SELECT role, created_at createdAt, is_default isDefault FROM workspace_members
					 WHERE workspace_id = ? AND user_id = ?`,
				)
				.get(workspaceId, userId) as {
				role: "owner" | "member";
				createdAt: number;
				isDefault: number;
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
					isDefault: Boolean(membership.isDefault),
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
			const hasMembership = this.db
				.prepare("SELECT 1 FROM workspace_members WHERE user_id = ? LIMIT 1")
				.get(userId);
			this.db
				.prepare("INSERT INTO workspaces(id, created_at) VALUES (?, ?)")
				.run(workspaceId, createdAt);
			this.db
				.prepare(
					`INSERT INTO workspace_members(workspace_id, user_id, role, created_at, is_default)
					 VALUES (?, ?, 'owner', ?, ?)`,
				)
				.run(workspaceId, userId, createdAt, hasMembership ? 0 : 1);
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
				isDefault: !hasMembership,
				claimed: true,
			};
		})();
	}

	mergeWorkspaces(
		sourceWorkspaceId: string,
		targetWorkspaceId: string,
		options: { dryRun?: boolean } = {},
	) {
		if (sourceWorkspaceId === targetWorkspaceId)
			throw new WorkspaceMergeError("Source and target workspaces must differ");
		if (
			this.db
				.prepare(
					"SELECT 1 FROM workspace_redirects WHERE from_workspace_id = ?",
				)
				.get(sourceWorkspaceId)
		)
			throw new WorkspaceMergeError("Source workspace is already merged");
		if (
			!this.db
				.prepare("SELECT 1 FROM workspaces WHERE id = ?")
				.get(sourceWorkspaceId) ||
			!this.db
				.prepare("SELECT 1 FROM workspaces WHERE id = ?")
				.get(targetWorkspaceId)
		)
			throw new WorkspaceMergeError("Both workspaces must exist");

		const sourceMembers = this.membersForWorkspace(sourceWorkspaceId);
		const targetMembers = this.membersForWorkspace(targetWorkspaceId);
		if (JSON.stringify(sourceMembers) !== JSON.stringify(targetMembers))
			throw new WorkspaceMergeError(
				"Workspaces must have identical memberships before merging",
			);

		const sourceBatches = this.db
			.prepare(
				`SELECT cursor, change_id changeId, device_id deviceId,
						device_sequence deviceSequence, clock, payload, created_at createdAt
				 FROM change_batches WHERE workspace_id = ? ORDER BY cursor`,
			)
			.all(sourceWorkspaceId) as Array<{
			cursor: number;
			changeId: string;
			deviceId: string;
			deviceSequence: number;
			clock: string;
			payload: string;
			createdAt: number;
		}>;
		const targetChangeIds = new Map(
			(
				this.db
					.prepare(
						"SELECT change_id changeId, payload FROM change_batches WHERE workspace_id = ?",
					)
					.all(targetWorkspaceId) as Array<{
					changeId: string;
					payload: string;
				}>
			).map((row) => [row.changeId, row.payload]),
		);
		const targetSequences = new Set(
			(
				this.db
					.prepare(
						"SELECT device_id deviceId, device_sequence deviceSequence FROM change_batches WHERE workspace_id = ?",
					)
					.all(targetWorkspaceId) as Array<{
					deviceId: string;
					deviceSequence: number;
				}>
			).map((row) => `${row.deviceId}:${row.deviceSequence}`),
		);
		const batches = sourceBatches.map((row) => {
			const payload = JSON.parse(row.payload) as ChangeBatch;
			if (payload.workspaceId !== sourceWorkspaceId)
				throw new WorkspaceMergeError("Source batch has an invalid workspace");
			const existing = targetChangeIds.get(row.changeId);
			if (existing && existing !== row.payload)
				throw new WorkspaceMergeError(`Change ID collision: ${row.changeId}`);
			if (targetSequences.has(`${row.deviceId}:${row.deviceSequence}`))
				throw new WorkspaceMergeError(
					`Device sequence collision: ${row.deviceId}:${row.deviceSequence}`,
				);
			return { row, payload: { ...payload, workspaceId: targetWorkspaceId } };
		});

		const sourceBlobs = this.db
			.prepare(
				`SELECT hash, content_type contentType, size
				 FROM blobs WHERE workspace_id = ? ORDER BY hash`,
			)
			.all(sourceWorkspaceId) as Array<{
			hash: string;
			contentType: string;
			size: number;
		}>;
		for (const blob of sourceBlobs) {
			const sourcePath = this.blobPath(sourceWorkspaceId, blob.hash);
			if (!existsSync(sourcePath))
				throw new WorkspaceMergeError(`Source blob is missing: ${blob.hash}`);
			const target = this.getBlobDescriptor(targetWorkspaceId, blob.hash);
			if (
				target &&
				(target.contentType !== blob.contentType || target.size !== blob.size)
			)
				throw new WorkspaceMergeError(
					`Blob descriptor collision: ${blob.hash}`,
				);
		}
		const report = {
			sourceWorkspaceId,
			targetWorkspaceId,
			batches: batches.length,
			blobs: sourceBlobs.length,
		};
		if (options.dryRun) return { ...report, applied: false };

		const copiedBlobPaths: string[] = [];
		try {
			for (const blob of sourceBlobs) {
				const targetPath = this.blobPath(targetWorkspaceId, blob.hash);
				if (!existsSync(targetPath)) {
					mkdirSync(dirname(targetPath), { recursive: true });
					copyFileSync(this.blobPath(sourceWorkspaceId, blob.hash), targetPath);
					copiedBlobPaths.push(targetPath);
				}
			}
			this.db.transaction(() => {
				const insertBatch = this.db.prepare(
					`INSERT INTO change_batches
					 (change_id, workspace_id, device_id, device_sequence, clock, payload, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				);
				const upsertDevice = this.db.prepare(
					`INSERT INTO devices(workspace_id, device_id, last_sequence)
					 VALUES (?, ?, ?)
					 ON CONFLICT(workspace_id, device_id) DO UPDATE
					 SET last_sequence = MAX(last_sequence, excluded.last_sequence)`,
				);
				const insertBlob = this.db.prepare(
					`INSERT OR IGNORE INTO blobs(workspace_id, hash, content_type, size, created_at)
					 VALUES (?, ?, ?, ?, ?)`,
				);
				for (const { row, payload } of batches) {
					if (!targetChangeIds.has(row.changeId))
						insertBatch.run(
							row.changeId,
							targetWorkspaceId,
							row.deviceId,
							row.deviceSequence,
							row.clock,
							JSON.stringify(payload),
							row.createdAt,
						);
					upsertDevice.run(targetWorkspaceId, row.deviceId, row.deviceSequence);
				}
				for (const blob of sourceBlobs) {
					insertBlob.run(
						targetWorkspaceId,
						blob.hash,
						blob.contentType,
						blob.size,
						Date.now(),
					);
				}
				this.db
					.prepare(
						`INSERT INTO workspace_redirects(from_workspace_id, to_workspace_id, merged_at)
						 VALUES (?, ?, ?)`,
					)
					.run(sourceWorkspaceId, targetWorkspaceId, Date.now());
			})();
		} catch (error) {
			for (const path of copiedBlobPaths)
				Bun.file(path)
					.delete()
					.catch(() => undefined);
			throw error;
		}
		return { ...report, applied: true };
	}

	/**
	 * Issues a headless agent credential. The email is denormalized because
	 * Better Auth owns a separate SQLite file, so there is no join available at
	 * verification time. Authorization still re-checks the live allowlist on
	 * every request, so a denormalized address can never widen access.
	 */
	createAgentToken(userId: string, userEmail: string, name: string) {
		const token = generateAgentToken();
		const id = randomUUID();
		const createdAt = Date.now();
		this.db
			.prepare(
				`INSERT INTO agent_tokens
				 (id, token_hash, user_id, user_email, name, created_at, last_used_at, revoked_at)
				 VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
			)
			.run(id, hashAgentToken(token), userId, userEmail, name, createdAt);
		// The only time the plaintext exists; it is never recoverable after this.
		return { id, token, name, createdAt };
	}

	listAgentTokens(userId: string) {
		return this.db
			.prepare(
				`SELECT id, name, created_at createdAt, last_used_at lastUsedAt,
				        revoked_at revokedAt
				 FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC`,
			)
			.all(userId) as Array<{
			id: string;
			name: string;
			createdAt: number;
			lastUsedAt: number | null;
			revokedAt: number | null;
		}>;
	}

	/** Scoped by user so one account cannot revoke another's credentials. */
	revokeAgentToken(userId: string, id: string) {
		const result = this.db
			.prepare(
				"UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
			)
			.run(Date.now(), id, userId);
		return result.changes > 0;
	}

	/** Revoked tokens are simply absent, so callers fail closed with a 401. */
	findActiveAgentToken(token: string) {
		const hash = hashAgentToken(token);
		const row = this.db
			.prepare(
				`SELECT id, token_hash tokenHash, user_id userId, user_email userEmail
				 FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL`,
			)
			.get(hash) as {
			id: string;
			tokenHash: string;
			userId: string;
			userEmail: string;
		} | null;
		if (!row || !hashesMatch(row.tokenHash, hash)) return null;
		return { id: row.id, userId: row.userId, userEmail: row.userEmail };
	}

	/**
	 * Records usage at most once a minute. Sync clients poll continuously, so an
	 * unconditional write here would add a database write to every poll.
	 */
	touchAgentToken(id: string, now = Date.now()) {
		this.db
			.prepare(
				"UPDATE agent_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
			)
			.run(now, id, now - 60_000);
	}

	private membersForWorkspace(workspaceId: string) {
		return this.db
			.prepare(
				`SELECT user_id userId, role FROM workspace_members
				 WHERE workspace_id = ? ORDER BY user_id`,
			)
			.all(workspaceId) as Array<{ userId: string; role: string }>;
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

export class WorkspaceMembershipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceMembershipError";
	}
}

export class WorkspaceMergeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceMergeError";
	}
}
