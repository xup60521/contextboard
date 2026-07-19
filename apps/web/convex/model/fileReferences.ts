import type { Id } from "../_generated/dataModel";

type RawRecord = Record<string, unknown>;

export type ExtractedFileRefs = {
	fileIds: Set<string>;
	legacyUrls: Set<string>;
};

export function extractCardImageRefs(content: unknown): ExtractedFileRefs {
	const fileIds = new Set<string>();
	const legacyUrls = new Set<string>();

	visitCardNode(content, fileIds, legacyUrls);

	return { fileIds, legacyUrls };
}

export function normalizeCardImageFileIds(
	content: unknown,
	urlToFileId: Map<string, Id<"files">>,
) {
	const { changed, value } = normalizeCardNode(content, urlToFileId);
	return { changed, content: value };
}

export function extractTldrawImageRefs(snapshot: unknown): ExtractedFileRefs {
	const fileIds = new Set<string>();
	const legacyUrls = new Set<string>();
	const store = getSnapshotStore(snapshot);
	if (!store) {
		return { fileIds, legacyUrls };
	}

	const referencedAssetIds = new Set<string>();
	for (const record of Object.values(store)) {
		collectAssetIdsInto(record, referencedAssetIds);
	}

	for (const [recordId, record] of Object.entries(store)) {
		if (!isObject(record)) continue;
		if (record.typeName !== "asset") continue;
		if (
			referencedAssetIds.size > 0 &&
			!referencedAssetIds.has(recordId) &&
			typeof record.id === "string" &&
			!referencedAssetIds.has(record.id)
		) {
			continue;
		}

		const meta = isObject(record.meta) ? record.meta : null;
		const rawFileId = meta && typeof meta.fileId === "string" ? meta.fileId : null;
		if (rawFileId) {
			fileIds.add(rawFileId);
			continue;
		}

		const props = isObject(record.props) ? record.props : null;
		if (props && typeof props.src === "string") {
			legacyUrls.add(props.src);
		}
	}

	return { fileIds, legacyUrls };
}

export function normalizeTldrawImageFileIds(
	snapshot: unknown,
	urlToFileId: Map<string, Id<"files">>,
) {
	const snapshotRecord = isObject(snapshot) ? snapshot : null;
	const store = getSnapshotStore(snapshot);
	if (!snapshotRecord || !store) {
		return { changed: false, snapshot };
	}

	let changed = false;
	const nextStore: RawRecord = { ...store };

	for (const [recordId, record] of Object.entries(store)) {
		if (!isObject(record) || record.typeName !== "asset") continue;

		const props = isObject(record.props) ? record.props : null;
		const src = props && typeof props.src === "string" ? props.src : null;
		if (!src) continue;

		const existingMeta = isObject(record.meta) ? record.meta : null;
		if (existingMeta && typeof existingMeta.fileId === "string") continue;

		const fileId = urlToFileId.get(src);
		if (!fileId) continue;

		nextStore[recordId] = {
			...record,
			meta: {
				...(existingMeta ?? {}),
				fileId,
			},
		};
		changed = true;
	}

	if (!changed) {
		return { changed: false, snapshot };
	}

	return {
		changed: true,
		snapshot: {
			...snapshotRecord,
			store: nextStore,
		},
	};
}

function visitCardNode(
	value: unknown,
	fileIds: Set<string>,
	legacyUrls: Set<string>,
) {
	if (!isObject(value)) return;

	if (value.type === "image") {
		const attrs = isObject(value.attrs) ? value.attrs : null;
		const fileId = attrs && typeof attrs.fileId === "string" ? attrs.fileId : null;
		const src = attrs && typeof attrs.src === "string" ? attrs.src : null;

		if (fileId) {
			fileIds.add(fileId);
		} else if (src) {
			legacyUrls.add(src);
		}
	}

	const content = Array.isArray(value.content) ? value.content : null;
	if (!content) return;

	for (const child of content) {
		visitCardNode(child, fileIds, legacyUrls);
	}
}

function normalizeCardNode(
	value: unknown,
	urlToFileId: Map<string, Id<"files">>,
): { changed: boolean; value: unknown } {
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((entry) => {
			const normalized = normalizeCardNode(entry, urlToFileId);
			if (normalized.changed) changed = true;
			return normalized.value;
		});
		return changed ? { changed: true, value: next } : { changed: false, value };
	}

	if (!isObject(value)) {
		return { changed: false, value };
	}

	let changed = false;
	let nextRecord: RawRecord = value;

	if (value.type === "image") {
		const attrs = isObject(value.attrs) ? value.attrs : null;
		const src = attrs && typeof attrs.src === "string" ? attrs.src : null;
		const hasFileId = attrs && typeof attrs.fileId === "string";
		if (src && !hasFileId) {
			const fileId = urlToFileId.get(src);
			if (fileId) {
				nextRecord = {
					...nextRecord,
					attrs: {
						...(attrs ?? {}),
						fileId,
					},
				};
				changed = true;
			}
		}
	}

	if (Array.isArray(value.content)) {
		const normalizedChildren = normalizeCardNode(value.content, urlToFileId);
		if (normalizedChildren.changed) {
			nextRecord = {
				...nextRecord,
				content: normalizedChildren.value,
			};
			changed = true;
		}
	}

	return changed ? { changed: true, value: nextRecord } : { changed: false, value };
}

function collectAssetIdsInto(value: unknown, assetIds: Set<string>) {
	if (!isObject(value)) {
		if (Array.isArray(value)) {
			for (const entry of value) {
				collectAssetIdsInto(entry, assetIds);
			}
		}
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		if (key === "assetId" && typeof child === "string") {
			assetIds.add(child);
			continue;
		}

		collectAssetIdsInto(child, assetIds);
	}
}

function getSnapshotStore(snapshot: unknown): RawRecord | null {
	if (!isObject(snapshot) || !isObject(snapshot.store)) {
		return null;
	}

	return snapshot.store;
}

function isObject(value: unknown): value is RawRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
