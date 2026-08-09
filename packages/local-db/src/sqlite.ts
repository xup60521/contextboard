import { Database } from "bun:sqlite";
import type {
	BoardItem,
	CanvasRecord,
	Card,
	CardContent,
	CardReference,
	CardRelation,
	FileReference,
	LocalFile,
	TldrawDocument,
	Whiteboard,
	WhiteboardReference,
} from "@contextboard/domain";
import type { ChangeBatch, ConflictRecord } from "@contextboard/sync-protocol";
import type {
	AppliedChangeBatch,
	ContextboardDatabaseLike,
	RowCollection,
	RowTable,
	RowWhereClause,
	Setting,
	SyncPeer,
	Todo,
} from "./index";

type JsonRecord = Record<string, unknown>;
type StoredBlob = {
	__contextboardType: "blob";
	type: string;
	base64: string;
};

function bytesToBase64(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

async function encodeValue(value: unknown): Promise<unknown> {
	if (value === undefined) return { __contextboardType: "undefined" };
	if (typeof Blob !== "undefined" && value instanceof Blob) {
		const bytes = new Uint8Array(await value.arrayBuffer());
		return {
			__contextboardType: "blob",
			type: value.type,
			base64: bytesToBase64(bytes),
		} satisfies StoredBlob;
	}
	if (Array.isArray(value))
		return Promise.all(value.map((item) => encodeValue(item)));
	if (isRecord(value)) {
		const entries = await Promise.all(
			Object.entries(value).map(
				async ([key, item]) => [key, await encodeValue(item)] as const,
			),
		);
		return Object.fromEntries(entries);
	}
	return value;
}

function decodeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decodeValue);
	if (!isRecord(value)) return value;
	if (value.__contextboardType === "undefined") return undefined;
	if (
		value.__contextboardType === "blob" &&
		typeof value.base64 === "string" &&
		typeof value.type === "string"
	) {
		return new Blob([base64ToBytes(value.base64) as BlobPart], {
			type: value.type,
		});
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, decodeValue(item)]),
	);
}

function valueAt(row: JsonRecord, index: string): unknown {
	if (index.startsWith("[") && index.endsWith("]")) {
		return index
			.slice(1, -1)
			.split("+")
			.map((part) => row[part]);
	}
	return row[index];
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function compareValues(left: unknown, right: unknown): number {
	if (sameValue(left, right)) return 0;
	if (left === undefined || left === null) return 1;
	if (right === undefined || right === null) return -1;
	if (typeof left === "number" && typeof right === "number")
		return left < right ? -1 : 1;
	const leftText = String(left);
	const rightText = String(right);
	return leftText < rightText ? -1 : 1;
}

class SqliteCollection<T> implements RowCollection<T> {
	constructor(
		private readonly table: SqliteRowTable<T>,
		private readonly predicate: (row: T) => boolean,
		private readonly sorter?: (left: T, right: T) => number,
		private readonly maximum?: number,
	) {}

	async toArray() {
		const rows = (await this.table.toArray()).filter(this.predicate);
		if (this.sorter) rows.sort(this.sorter);
		return this.maximum === undefined ? rows : rows.slice(0, this.maximum);
	}

	async first() {
		return (await this.toArray())[0];
	}

	async count() {
		return (await this.toArray()).length;
	}

	limit(count: number) {
		return new SqliteCollection(
			this.table,
			this.predicate,
			this.sorter,
			Math.max(0, count),
		);
	}

	reverse() {
		const currentSorter = this.sorter;
		const sorter = currentSorter
			? (left: T, right: T) => -currentSorter(left, right)
			: undefined;
		return new SqliteCollection(this.table, this.predicate, sorter, this.maximum);
	}

	filter(predicate: (row: T) => boolean) {
		return new SqliteCollection(
			this.table,
			(row) => this.predicate(row) && predicate(row),
			this.sorter,
			this.maximum,
		);
	}
}

class SqliteWhereClause<T> implements RowWhereClause<T> {
	constructor(
		private readonly table: SqliteRowTable<T>,
		private readonly index: string,
	) {}

	equals(value: any) {
		return new SqliteCollection(this.table, (row) =>
			sameValue(valueAt(row as unknown as JsonRecord, this.index), value),
		);
	}
}

/** A JSON row table backed by one SQLite table. */
export class SqliteRowTable<T = any> implements RowTable<T> {
	constructor(
		private readonly database: Database,
		private readonly tableName: string,
		private readonly keyField: string,
	) {}

	async get(key: any) {
		if (key === undefined || key === null) return undefined;
		const row = this.database
			.query(`SELECT data FROM "${this.tableName}" WHERE row_key = ?`)
			.get(String(key)) as { data?: unknown } | null;
		if (!row || typeof row.data !== "string") return undefined;
		return decodeValue(JSON.parse(row.data)) as T;
	}

	async bulkGet(keys: any[]) {
		return Promise.all(keys.map((key) => this.get(key)));
	}

	async put(value: T) {
		return this.#write(value, "REPLACE");
	}

	async add(value: T) {
		return this.#write(value, "INSERT");
	}

	async #write(value: T, mode: "REPLACE" | "INSERT") {
		const encoded = await encodeValue(value);
		const key = (value as unknown as JsonRecord)[this.keyField];
		if (typeof key !== "string" && typeof key !== "number")
			throw new Error(`Missing ${this.keyField} for ${this.tableName}`);
		const sql =
			mode === "INSERT"
				? `INSERT INTO "${this.tableName}" (row_key, data) VALUES (?, ?)`
				: `INSERT OR REPLACE INTO "${this.tableName}" (row_key, data) VALUES (?, ?)`;
		this.database.query(sql).run(String(key), JSON.stringify(encoded));
		return key;
	}

	async bulkPut(values: T[]) {
		for (const value of values) await this.put(value);
	}

	async bulkAdd(values: T[]) {
		for (const value of values) await this.add(value);
	}

	async bulkDelete(keys: any[]) {
		for (const key of keys) await this.delete(key);
	}

	async delete(key: any) {
		this.database
			.query(`DELETE FROM "${this.tableName}" WHERE row_key = ?`)
			.run(String(key));
	}

	async update(key: any, changes: Partial<T>) {
		const existing = await this.get(key);
		if (!existing) return 0;
		await this.put({ ...existing, ...changes } as T);
		return 1;
	}

	async clear() {
		this.database.query(`DELETE FROM "${this.tableName}"`).run();
	}

	async toArray() {
		const rows = this.database
			.query(`SELECT data FROM "${this.tableName}"`)
			.all() as Array<{ data?: unknown }>;
		return rows
			.filter((row) => typeof row.data === "string")
			.map((row) => decodeValue(JSON.parse(row.data as string)) as T);
	}

	async count() {
		const row = this.database
			.query(`SELECT COUNT(*) AS count FROM "${this.tableName}"`)
			.get() as { count?: number } | null;
		return Number(row?.count ?? 0);
	}

	where(index: string) {
		return new SqliteWhereClause(this, index);
	}

	orderBy(index: string) {
		return new SqliteCollection(
			this,
			() => true,
			(left, right) =>
				compareValues(
					valueAt(left as unknown as JsonRecord, index),
					valueAt(right as unknown as JsonRecord, index),
				),
		);
	}
}

const TABLE_KEYS = {
	whiteboards: "id",
	cards: "id",
	boardItems: "id",
	tldrawDocuments: "id",
	files: "id",
	fileReferences: "id",
	cardReferences: "id",
	whiteboardReferences: "id",
	cardRelations: "id",
	cardContents: "id",
	canvasRecords: "id",
	settings: "key",
	changeLog: "changeId",
	syncPeers: "peerId",
	conflicts: "conflictId",
	appliedChangeBatches: "changeId",
	todos: "id",
} as const;

type TableName = keyof typeof TABLE_KEYS;

function createTable(database: Database, name: TableName) {
	database.run(
		`CREATE TABLE IF NOT EXISTS "${name}" (row_key TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`,
	);
	return new SqliteRowTable(database, name, TABLE_KEYS[name]);
}

/**
 * Persistent headless replica database. It intentionally keeps the same
 * materialized-row and change-log semantics as the IndexedDB database; only
 * the table/transaction adapter is different.
 */
export class SqliteContextboardDatabase implements ContextboardDatabaseLike {
	readonly whiteboards: RowTable<Whiteboard>;
	readonly cards: RowTable<Card>;
	readonly cardContents: RowTable<CardContent>;
	readonly boardItems: RowTable<BoardItem>;
	readonly tldrawDocuments: RowTable<TldrawDocument>;
	readonly files: RowTable<LocalFile>;
	readonly fileReferences: RowTable<FileReference>;
	readonly cardReferences: RowTable<CardReference>;
	readonly whiteboardReferences: RowTable<WhiteboardReference>;
	readonly cardRelations: RowTable<CardRelation>;
	readonly canvasRecords: RowTable<CanvasRecord>;
	readonly settings: RowTable<Setting>;
	readonly changeLog: RowTable<ChangeBatch>;
	readonly syncPeers: RowTable<SyncPeer>;
	readonly conflicts: RowTable<ConflictRecord>;
	readonly appliedChangeBatches: RowTable<AppliedChangeBatch>;
	readonly todos: RowTable<Todo>;

	readonly #database: Database;
	#transactionTail: Promise<void> = Promise.resolve();

	constructor(readonly path: string) {
		this.#database = new Database(path);
		this.#database.run("PRAGMA journal_mode = WAL");
		this.whiteboards = createTable(this.#database, "whiteboards");
		this.cards = createTable(this.#database, "cards");
		this.cardContents = createTable(this.#database, "cardContents");
		this.boardItems = createTable(this.#database, "boardItems");
		this.tldrawDocuments = createTable(this.#database, "tldrawDocuments");
		this.files = createTable(this.#database, "files");
		this.fileReferences = createTable(this.#database, "fileReferences");
		this.cardReferences = createTable(this.#database, "cardReferences");
		this.whiteboardReferences = createTable(this.#database, "whiteboardReferences");
		this.cardRelations = createTable(this.#database, "cardRelations");
		this.canvasRecords = createTable(this.#database, "canvasRecords");
		this.settings = createTable(this.#database, "settings");
		this.changeLog = createTable(this.#database, "changeLog");
		this.syncPeers = createTable(this.#database, "syncPeers");
		this.conflicts = createTable(this.#database, "conflicts");
		this.appliedChangeBatches = createTable(
			this.#database,
			"appliedChangeBatches",
		);
		this.todos = createTable(this.#database, "todos");
	}

	async transaction(...args: any[]) {
		const callback = args.at(-1);
		if (typeof callback !== "function")
			throw new Error("A database transaction callback is required");

		let release!: () => void;
		const previous = this.#transactionTail;
		this.#transactionTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		let began = false;
		try {
			this.#database.run("BEGIN IMMEDIATE");
			began = true;
			const result = await callback(this);
			this.#database.run("COMMIT");
			began = false;
			return result;
		} catch (error) {
			if (began) {
				try {
					this.#database.run("ROLLBACK");
				} catch {
					// Preserve the original transaction error.
				}
			}
			throw error;
		} finally {
			release();
		}
	}

	close() {
		this.#database.close();
	}
}

export const createSqliteContextboardDatabase = (path: string) =>
	new SqliteContextboardDatabase(path);
