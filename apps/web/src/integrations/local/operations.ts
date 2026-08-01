import {
	type ArchiveCardSnapshot,
	planAppendCard,
	planArchiveCards,
	planArchiveItem,
	planCreateCardItem,
	planCreateSubwhiteboard,
	planReferences,
	planRestoreOrAdoptCardItem,
} from "@contextboard/application/canvas";
import {
	DEFAULT_CARD_CONTENT,
	deriveCardMetadata,
} from "@contextboard/application/cards";
import type {
	BoardItem,
	Card,
	CardId,
	CardReference,
	CardRelation,
	CardRelationKind,
	FileReference,
	LocalFile,
	Whiteboard,
	WhiteboardId,
} from "@contextboard/domain";
import {
	type ContextboardDatabase,
	runLocalCommand,
	type Todo,
	waitForExternal,
} from "@contextboard/local-db";
import {
	conflictCopyCardId,
	type EntityChange,
	HybridLogicalClock,
	type SyncEntityType,
} from "@contextboard/sync-protocol";

type Args = Record<string, unknown>;
const DEFAULT_CARD_WIDTH = 576;
const active = <
	T extends { archivedAt?: number | null; deletedAt: number | null },
>(
	row: T,
) =>
	row.deletedAt === null && row.archivedAt !== undefined
		? row.archivedAt === null
		: row.deletedAt === null;
const publicRow = <T extends { id: string; createdAt: number }>(row: T) => ({
	...row,
	_id: row.id,
	_creationTime: row.createdAt,
	...("contentVersion" in row ? { version: row.contentVersion } : {}),
	...("documentVersion" in row ? { version: row.documentVersion } : {}),
});
const id = () => crypto.randomUUID();

function parseClipboardCardContent(content: unknown) {
	if (typeof content !== "string" || !content) return DEFAULT_CARD_CONTENT;
	try {
		const parsed = JSON.parse(content) as { type?: unknown };
		return parsed && typeof parsed === "object" && parsed.type === "doc"
			? parsed
			: DEFAULT_CARD_CONTENT;
	} catch {
		return DEFAULT_CARD_CONTENT;
	}
}

async function reconcileReferences(
	db: ContextboardDatabase,
	deviceId: string,
	targetType: "card" | "tldrawDocument",
	targetId: string,
	content: unknown,
) {
	const targetKey = `${targetType}:${targetId}`;
	const current = await db.fileReferences
		.where("targetKey")
		.equals(targetKey)
		.toArray();
	const allFileReferences = await db.fileReferences.toArray();
	const currentCards =
		targetType === "card"
			? await db.cardReferences.where("sourceCardId").equals(targetId).toArray()
			: [];
	const plan = planReferences(
		{
			targetFileReferences: current,
			allFileReferences,
			cardReferences: currentCards,
			files: await db.files.toArray(),
		},
		{ targetType, targetId, content },
		{ now: Date.now(), deviceId },
	);
	for (const write of plan.writes) {
		if (write.entity === "fileReference") {
			if (write.operation === "delete")
				await db.fileReferences.delete(write.id);
			else
				await db.fileReferences.add({
					...(write.value as FileReference),
					revision: 1,
				});
		} else if (write.entity === "cardReference") {
			if (write.operation === "delete")
				await db.cardReferences.delete(write.id);
			else
				await db.cardReferences.add({
					...(write.value as CardReference),
					revision: 1,
				});
		} else if (write.entity === "file") {
			await db.files.update(write.id, {
				...(write.value as Partial<LocalFile>),
				revision: (write.expectedRevision ?? 0) + 1,
				updatedAt: Date.now(),
				updatedByDeviceId: deviceId,
			});
		}
	}
}

async function blobDataUrl(blob: Blob): Promise<string> {
	return await waitForExternal(
		new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () =>
				reject(reader.error ?? new Error("Could not read local image"));
			reader.readAsDataURL(blob);
		}),
	);
}

async function placementFor(
	db: ContextboardDatabase,
	cardId: string,
	preferred?: string | null,
) {
	const rows = (
		await db.boardItems.where("cardId").equals(cardId).toArray()
	).filter(active);
	return (
		rows.find((row) => preferred && row.whiteboardId === preferred) ??
		rows.sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
		null
	);
}

async function listActiveWhiteboards(db: ContextboardDatabase) {
	const rows = (await db.whiteboards.toArray()).filter(active);
	return Promise.all(
		rows
			.sort((a, b) => a.title.localeCompare(b.title))
			.map(async (row) => ({
				_id: row.id,
				title: row.title,
				breadcrumbs: (
					await Promise.all(
						row.ancestorIds.map((ancestorId) => db.whiteboards.get(ancestorId)),
					)
				)
					.filter((item): item is Whiteboard => !!item && active(item))
					.map(publicRow),
			})),
	);
}

async function enrichCard(db: ContextboardDatabase, card: Card) {
	const placements = (
		await db.boardItems.where("cardId").equals(card.id).toArray()
	).filter(active);
	const preferred = await placementFor(db, card.id);
	const whiteboard = preferred?.whiteboardId
		? await db.whiteboards.get(preferred.whiteboardId)
		: null;
	const breadcrumbs = whiteboard
		? (
				await Promise.all(
					[...whiteboard.ancestorIds, whiteboard.id].map((entry) =>
						db.whiteboards.get(entry),
					),
				)
			)
				.filter((entry): entry is Whiteboard => !!entry && active(entry))
				.map(publicRow)
		: [];
	const refs = await db.cardReferences
		.where("targetCardId")
		.equals(card.id)
		.toArray();
	const backlinks = (
		await Promise.all(refs.map((ref) => db.cards.get(ref.sourceCardId)))
	)
		.filter((entry): entry is Card => !!entry && active(entry))
		.map((entry) => ({
			cardId: entry.id,
			title: entry.derivedTitle,
			preview: entry.preview,
		}))
		.sort((a, b) => a.title.localeCompare(b.title));
	return {
		card: { ...publicRow(card), content: card.content },
		placements: placements.map((placement) => ({
			itemId: placement.id,
			whiteboardId: placement.whiteboardId,
			shapeId: placement.shapeId,
			updatedAt: placement.updatedAt,
		})),
		preferredPlacement: preferred ? publicRow(preferred) : null,
		whiteboard: whiteboard ? publicRow(whiteboard) : null,
		breadcrumbs,
		backlinks,
		boardWhiteboardId: preferred?.whiteboardId ?? null,
		shapeId: preferred?.shapeId ?? null,
	};
}

async function search(
	db: ContextboardDatabase,
	term: string,
	whiteboardId?: string,
) {
	const normalized = term.trim().toLocaleLowerCase();
	let cards = (await db.cards.toArray()).filter(active);
	let whiteboards = (await db.whiteboards.toArray()).filter(active);
	if (whiteboardId) {
		const itemCardIds = new Set(
			(await db.boardItems.toArray())
				.filter(
					(item) =>
						active(item) && item.whiteboardId === whiteboardId && item.cardId,
				)
				.map((item) => item.cardId),
		);
		cards = cards.filter((card) => itemCardIds.has(card.id));
		whiteboards = whiteboards.filter(
			(board) => board.parentWhiteboardId === whiteboardId,
		);
	}
	if (normalized) {
		cards = cards.filter((card) =>
			`${card.derivedTitle} ${card.plainText}`
				.toLocaleLowerCase()
				.includes(normalized),
		);
		whiteboards = whiteboards.filter((board) =>
			board.title.toLocaleLowerCase().includes(normalized),
		);
	}
	cards = cards.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
	whiteboards = whiteboards.slice(0, 8);
	return {
		cards: await Promise.all(
			cards.map(async (card) => {
				const item = await placementFor(db, card.id, whiteboardId);
				return {
					kind: "card",
					id: card.id,
					title: card.derivedTitle,
					preview: card.preview,
					content: card.content,
					boardWhiteboardId: item?.whiteboardId ?? null,
					shapeId: item?.shapeId ?? null,
				};
			}),
		),
		whiteboards: await Promise.all(
			whiteboards.map(async (board) => {
				const item = (
					await db.boardItems
						.where("childWhiteboardId")
						.equals(board.id)
						.toArray()
				).find(active);
				return {
					kind: "whiteboard",
					id: board.id,
					title: board.title,
					boardWhiteboardId: item?.whiteboardId ?? board.parentWhiteboardId,
					shapeId: item?.shapeId ?? null,
				};
			}),
		),
	};
}

export async function localQuery(
	db: ContextboardDatabase,
	reference: string,
	args: Args = {},
): Promise<any> {
	switch (reference) {
		case "whiteboards.get": {
			const row = await db.whiteboards.get(String(args.whiteboardId));
			return row && active(row) ? publicRow(row) : null;
		}
		case "whiteboards.getBreadcrumbs": {
			const row = await db.whiteboards.get(String(args.whiteboardId));
			if (!row || !active(row)) return [];
			return (
				await Promise.all(
					[...row.ancestorIds, row.id].map((entry) =>
						db.whiteboards.get(entry),
					),
				)
			)
				.filter((entry): entry is Whiteboard => !!entry && active(entry))
				.map(publicRow);
		}
		case "whiteboards.listActive":
			return listActiveWhiteboards(db);
		case "cards.get": {
			const row = await db.cards.get(String(args.cardId));
			return row && active(row) ? enrichCard(db, row) : null;
		}
		case "cards.getContentsForWhiteboardItems": {
			const ids = Array.isArray(args.cardIds) ? args.cardIds.map(String) : [];
			const rows = await db.cards.bulkGet(ids);
			return rows
				.filter((row): row is Card => !!row && active(row))
				.map((row) => ({
					cardId: row.id,
					content: row.content,
					version: row.contentVersion,
				}));
		}
		case "cards.listAll": {
			let rows = (await db.cards.toArray()).filter(active);
			const term =
				typeof args.searchTerm === "string"
					? args.searchTerm.trim().toLocaleLowerCase()
					: "";
			if (term)
				rows = rows.filter((row) =>
					`${row.derivedTitle} ${row.plainText}`
						.toLocaleLowerCase()
						.includes(term),
				);
			if (args.orphanOnly === true)
				rows = rows.filter((row) => row.activePlacementCount === 0);
			const sort = args.sortBy;
			rows.sort(
				sort === "title"
					? (a, b) => a.derivedTitle.localeCompare(b.derivedTitle)
					: sort === "title_desc"
						? (a, b) => b.derivedTitle.localeCompare(a.derivedTitle)
						: sort === "updated_asc"
							? (a, b) => a.updatedAt - b.updatedAt
							: (a, b) => b.updatedAt - a.updatedAt,
			);
			return rows.map(publicRow);
		}
		case "canvas.listItems": {
			const [allItems, allCards, allWhiteboards] = await Promise.all([
				db.boardItems.toArray(),
				db.cards.toArray(),
				db.whiteboards.toArray(),
			]);
			const rows = allItems
				.filter(
					(row) =>
						active(row) && row.whiteboardId === (args.whiteboardId ?? null),
				)
				.sort((a, b) => a.zIndex - b.zIndex);
			const cardById = new Map(
				allCards.filter(active).map((card) => [card.id, card]),
			);
			const activeBoards = allWhiteboards.filter(active);
			const boardById = new Map(activeBoards.map((board) => [board.id, board]));
			return rows.map((row) => {
				const card = row.cardId ? cardById.get(row.cardId) : null;
				const child = row.childWhiteboardId
					? boardById.get(row.childWhiteboardId)
					: null;
				return {
					...publicRow(row),
					card: card
						? {
								_id: card.id,
								derivedTitle: card.derivedTitle,
								preview: card.preview,
								version: card.contentVersion,
							}
						: null,
					childWhiteboard: child
						? {
								_id: child.id,
								title: child.title,
								depth: child.depth,
								cardCount: allItems.filter(
									(item) =>
										active(item) &&
										item.whiteboardId === child.id &&
										item.kind === "card",
								).length,
								childWhiteboardCount: activeBoards.filter(
									(board) => board.parentWhiteboardId === child.id,
								).length,
							}
						: null,
				};
			});
		}
		case "tldrawDocuments.get": {
			const target = args.whiteboardId ?? null;
			const row =
				target === null
					? (await db.tldrawDocuments.toArray()).find(
							(entry) => entry.whiteboardId === null,
						)
					: await db.tldrawDocuments
							.where("whiteboardId")
							.equals(String(target))
							.first();
			const allRecords =
				typeof target === "string"
					? await db.canvasRecords
							.where("whiteboardId")
							.equals(target)
							.toArray()
					: [];
			const records = allRecords.filter(active);
			if (allRecords.length > 0) {
				const legacy = row?.snapshot as
					| { schema?: unknown; store?: Record<string, unknown> }
					| undefined;
				return {
					...(row ? publicRow(row) : {}),
					whiteboardId: target,
					snapshot: {
						schema: legacy?.schema ?? null,
						store: Object.fromEntries(
							records.map((record) => [record.recordId, record.payload]),
						),
					},
					revision: Math.max(0, ...records.map((record) => record.revision)),
					canvasRecordVersions: Object.fromEntries(
						allRecords.map((record) => [record.recordId, record.revision]),
					),
				};
			}
			return row && active(row)
				? {
						...publicRow(row),
						whiteboardId: target,
						snapshot: row.snapshot,
						revision: row.revision,
					}
				: null;
		}
		case "search.searchGlobal":
			return search(db, String(args.term ?? ""));
		case "search.searchInWhiteboard":
			return search(db, String(args.term ?? ""), String(args.whiteboardId));
		case "search.searchCardsForReference": {
			const results = await search(
				db,
				String(args.term ?? ""),
				typeof args.whiteboardId === "string" && !args.term
					? args.whiteboardId
					: undefined,
			);
			return results.cards.map(
				({ id: cardId, title, preview, boardWhiteboardId, shapeId }) => ({
					id: cardId,
					title,
					preview,
					boardWhiteboardId,
					shapeId,
				}),
			);
		}
		case "sidebar.get": {
			const whiteboardIds = Array.isArray(args.whiteboardIds)
				? args.whiteboardIds.map(String)
				: [];
			const cardIds = Array.isArray(args.cardIds)
				? args.cardIds.map(String)
				: [];
			const boards = (await db.whiteboards.bulkGet(whiteboardIds))
				.filter((row): row is Whiteboard => !!row && active(row))
				.map((row) => ({ _id: row.id, title: row.title }))
				.sort((a, b) => a.title.localeCompare(b.title));
			const cards = (await db.cards.bulkGet(cardIds))
				.filter((row): row is Card => !!row && active(row))
				.map((row) => ({
					_id: row.id,
					title: row.derivedTitle || "Untitled card",
				}));
			return { whiteboards: boards, cards };
		}
		case "files.getImageUrl": {
			const row = await db.files.get(String(args.storageId));
			return row?.blob ? URL.createObjectURL(row.blob) : null;
		}
		case "relations.list": {
			const cardId = typeof args.cardId === "string" ? args.cardId : null;
			const whiteboardId =
				typeof args.whiteboardId === "string" ? args.whiteboardId : null;
			return (await db.cardRelations.toArray())
				.filter(
					(row) =>
						active(row) &&
						(!cardId ||
							row.sourceCardId === cardId ||
							row.targetCardId === cardId) &&
						(!whiteboardId || row.whiteboardId === whiteboardId),
				)
				.sort(
					(a, b) =>
						(a.ordinal ?? Number.MAX_SAFE_INTEGER) -
							(b.ordinal ?? Number.MAX_SAFE_INTEGER) ||
						a.createdAt - b.createdAt ||
						a.id.localeCompare(b.id),
				)
				.map(publicRow);
		}
		case "todos.list":
			return (await db.todos.toArray())
				.filter((row) => row.deletedAt === null)
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((row) => ({ ...row, _id: row.id, _creationTime: row.createdAt }));
		default:
			throw new Error(`Unsupported local query: ${reference}`);
	}
}

function base(deviceId: string, now: number) {
	return {
		revision: 1,
		createdAt: now,
		updatedAt: now,
		updatedByDeviceId: deviceId,
		deletedAt: null,
	};
}
async function executeMutation(
	db: ContextboardDatabase,
	deviceId: string,
	workspaceId: string,
	reference: string,
	args: Args = {},
) {
	const now = Date.now();
	switch (reference) {
		case "whiteboards.updateTitle": {
			const row = await db.whiteboards.get(String(args.whiteboardId));
			if (!row || !active(row)) throw new Error("Whiteboard not found");
			const title =
				String(args.title ?? "")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 120) || "Untitled whiteboard";
			await db.whiteboards.update(row.id, {
				title,
				updatedAt: now,
				revision: row.revision + 1,
				updatedByDeviceId: deviceId,
			});
			return title;
		}
		case "cards.updateContent": {
			const row = await db.cards.get(String(args.cardId));
			if (!row || !active(row)) throw new Error("Card not found");
			if (
				typeof args.expectedVersion === "number" &&
				args.expectedVersion !== row.contentVersion
			) {
				throw new Error("Card was updated elsewhere");
			}
			const content = args.content;
			if (JSON.stringify(content) === JSON.stringify(row.content)) {
				return row.contentVersion;
			}
			const nextVersion = row.contentVersion + 1;
			await db.cards.update(row.id, {
				content,
				...deriveCardMetadata(content),
				contentVersion: nextVersion,
				updatedAt: now,
				revision: row.revision + 1,
				updatedByDeviceId: deviceId,
			});
			await reconcileReferences(db, deviceId, "card", row.id, content);
			return nextVersion;
		}
		case "cards.create": {
			const cardId = id() as CardId;
			const content = args.content ?? DEFAULT_CARD_CONTENT;
			const card: Card = {
				id: cardId,
				...base(deviceId, now),
				...deriveCardMetadata(content),
				content,
				contentVersion: 1,
				activePlacementCount: 0,
				archivedAt: null,
			};
			await db.cards.add(card);
			await reconcileReferences(db, deviceId, "card", cardId, content);
			return cardId;
		}
		case "canvas.createCardItem": {
			const whiteboardId = String(args.whiteboardId) as WhiteboardId;
			const board = await db.whiteboards.get(whiteboardId);
			if (!board || !active(board)) throw new Error("Whiteboard not found");
			const cardId = id() as CardId;
			const content = args.content ?? DEFAULT_CARD_CONTENT;
			const itemId = id();
			const plan = planCreateCardItem(
				{
					whiteboardId,
					cardId,
					itemId,
					shapeId: String(args.shapeId),
					content,
					x: Number(args.x ?? 0),
					y: Number(args.y ?? 0),
					w: Number(args.w ?? DEFAULT_CARD_WIDTH),
					h: Number(args.h ?? 180),
					rotation: Number(args.rotation ?? 0),
				},
				{ now, deviceId },
			);
			for (const write of plan.writes) {
				if (write.entity === "card")
					await db.cards.add({
						...(write.value as Card),
						revision: 1,
					});
				else if (write.entity === "boardItem")
					await db.boardItems.add({
						...(write.value as BoardItem),
						revision: 1,
					});
			}
			await reconcileReferences(db, deviceId, "card", cardId, content);
			return plan.result;
		}
		case "canvas.createSubwhiteboardItem": {
			const parentId = (args.parentWhiteboardId ?? null) as WhiteboardId | null;
			const parent = parentId ? await db.whiteboards.get(parentId) : null;
			const boardId = id() as WhiteboardId;
			const activeChildCount = parentId
				? (await db.whiteboards.toArray()).filter(
						(board) => active(board) && board.parentWhiteboardId === parentId,
					).length
				: 0;
			const itemId = id();
			const plan = planCreateSubwhiteboard(
				{ parent: parent ?? null, activeChildCount },
				{
					boardId,
					itemId,
					shapeId: String(args.shapeId),
					x: Number(args.x ?? 0),
					y: Number(args.y ?? 0),
					w: Number(args.w ?? 320),
					h: Number(args.h ?? 180),
					rotation: Number(args.rotation ?? 0),
				},
				{ now, deviceId },
			);
			await db.transaction("rw", db.whiteboards, db.boardItems, async () => {
				for (const write of plan.writes) {
					if (write.entity === "whiteboard")
						await db.whiteboards.add({
							...(write.value as Whiteboard),
							revision: 1,
						});
					else if (write.entity === "boardItem")
						await db.boardItems.add({
							...(write.value as BoardItem),
							revision: 1,
						});
				}
			});
			return plan.result;
		}
		case "canvas.updateItemFrame": {
			const row = await db.boardItems.get(String(args.itemId));
			if (!row) throw new Error("Item not found");
			await db.boardItems.update(row.id, {
				x: Number(args.x),
				y: Number(args.y),
				w: Number(args.w),
				h: Number(args.h),
				rotation: Number(args.rotation),
				zIndex: Number(args.zIndex),
				updatedAt: now,
				revision: row.revision + 1,
			});
			return null;
		}
		case "canvas.applyRecordChanges": {
			const whiteboardId = String(args.whiteboardId ?? "");
			if (!whiteboardId) throw new Error("Canvas records require a whiteboard");
			if (
				(await db.canvasRecords
					.where("whiteboardId")
					.equals(whiteboardId)
					.count()) === 0
			) {
				const legacy = await db.tldrawDocuments
					.where("whiteboardId")
					.equals(whiteboardId)
					.first();
				const legacyStore = (
					legacy?.snapshot as { store?: unknown } | undefined
				)?.store;
				if (legacyStore && typeof legacyStore === "object") {
					for (const payload of Object.values(
						legacyStore as Record<string, unknown>,
					)) {
						if (!payload || typeof payload !== "object") continue;
						const record = payload as {
							id?: unknown;
							type?: unknown;
							typeName?: unknown;
						};
						if (
							typeof record.id !== "string" ||
							record.type === "markdown-card" ||
							record.type === "subwhiteboard-link"
						)
							continue;
						await db.canvasRecords.put({
							id: `${whiteboardId}:${record.id}` as never,
							...base(deviceId, now),
							whiteboardId: whiteboardId as never,
							recordId: record.id,
							recordType: String(record.typeName ?? record.type ?? "unknown"),
							payload,
							clock: `${String(now).padStart(13, "0")}:000000:${deviceId}`,
						});
					}
				}
			}
			const added = Array.isArray(args.added) ? args.added : [];
			const updated = Array.isArray(args.updated) ? args.updated : [];
			const removed = Array.isArray(args.removed) ? args.removed : [];
			const versions: Record<string, number> = {};
			for (const payload of [...added, ...updated]) {
				if (!payload || typeof payload !== "object") continue;
				const record = payload as {
					id?: unknown;
					typeName?: unknown;
					type?: unknown;
				};
				if (typeof record.id !== "string") continue;
				const persisted = await db.canvasRecords
					.where("[whiteboardId+recordId]")
					.equals([whiteboardId, record.id])
					.first();
				const revision = (persisted?.revision ?? 0) + 1;
				await db.canvasRecords.put({
					id: (persisted?.id ?? `${whiteboardId}:${record.id}`) as never,
					...base(deviceId, now),
					createdAt: persisted?.createdAt ?? now,
					whiteboardId: whiteboardId as never,
					recordId: record.id,
					recordType: String(record.typeName ?? record.type ?? "unknown"),
					payload,
					clock: `${String(now).padStart(13, "0")}:000000:${deviceId}`,
					revision,
				});
				versions[record.id] = revision;
			}
			for (const recordId of removed.map(String)) {
				const persisted = await db.canvasRecords
					.where("[whiteboardId+recordId]")
					.equals([whiteboardId, recordId])
					.first();
				if (!persisted) continue;
				await db.canvasRecords.put({
					...persisted,
					deletedAt: now,
					updatedAt: now,
					updatedByDeviceId: deviceId,
					revision: persisted.revision + 1,
					clock: `${String(now).padStart(13, "0")}:000000:${deviceId}`,
				});
				versions[recordId] = persisted.revision + 1;
			}
			return {
				applied: added.length + updated.length + removed.length,
				versions,
			};
		}
		case "canvas.archiveItem": {
			const row = await db.boardItems.get(String(args.itemId));
			if (!row || !active(row)) return null;
			const card = row.cardId ? await db.cards.get(row.cardId) : null;
			const relations = row.cardId
				? (
						await db.cardRelations
							.where("whiteboardId")
							.equals(String(row.whiteboardId))
							.toArray()
					).filter(active)
				: [];
			const plan = planArchiveItem(
				{ item: row, card: card ?? null, relations },
				{ deleteCards: Boolean(args.deleteCards) },
				{ now },
			);
			for (const write of plan.writes) {
				if (write.entity === "boardItem")
					await db.boardItems.update(write.id, {
						...(write.value as Partial<BoardItem>),
						updatedAt: now,
						revision: (write.expectedRevision ?? 0) + 1,
						updatedByDeviceId: deviceId,
					});
				else if (write.entity === "card")
					await db.cards.update(write.id, {
						...(write.value as Partial<Card>),
						updatedAt: now,
						revision: (write.expectedRevision ?? 0) + 1,
						updatedByDeviceId: deviceId,
					});
				else if (write.entity === "cardRelation")
					await db.cardRelations.update(write.id, {
						deletedAt: now,
						updatedAt: now,
						revision: (write.expectedRevision ?? 0) + 1,
						updatedByDeviceId: deviceId,
					});
			}
			return null;
		}
		case "cards.archiveCard":
		case "cards.archiveCards": {
			const ids = reference.endsWith("archiveCard")
				? [String(args.cardId)]
				: Array.isArray(args.cardIds)
					? args.cardIds.map(String)
					: [];
			await db.transaction(
				"rw",
				db.cards,
				db.boardItems,
				db.cardRelations,
				async () => {
					const snapshots: ArchiveCardSnapshot[] = [];
					for (const cardId of ids) {
						const card = await db.cards.get(cardId);
						if (!card) continue;
						const placements = (
							await db.boardItems.where("cardId").equals(cardId).toArray()
						).filter(active);
						const relations = (await db.cardRelations.toArray()).filter(
							(relation) =>
								active(relation) &&
								(relation.sourceCardId === cardId ||
									relation.targetCardId === cardId),
						);
						snapshots.push({ card, placements, relations });
					}
					const plan = planArchiveCards(snapshots, { now });
					for (const write of plan.writes) {
						if (write.entity === "boardItem")
							await db.boardItems.update(write.id, {
								...(write.value as Partial<BoardItem>),
								updatedAt: now,
								revision: (write.expectedRevision ?? 0) + 1,
								updatedByDeviceId: deviceId,
							});
						else if (write.entity === "card")
							await db.cards.update(write.id, {
								...(write.value as Partial<Card>),
								updatedAt: now,
								revision: (write.expectedRevision ?? 0) + 1,
								updatedByDeviceId: deviceId,
							});
						else if (write.entity === "cardRelation")
							await db.cardRelations.update(write.id, {
								deletedAt: now,
								updatedAt: now,
								revision: (write.expectedRevision ?? 0) + 1,
								updatedByDeviceId: deviceId,
							} satisfies Partial<CardRelation>);
					}
				},
			);
			return null;
		}
		case "cards.appendToWhiteboard":
		case "cards.appendCardsToWhiteboard": {
			const single = reference === "cards.appendToWhiteboard";
			const cardIds = single
				? [String(args.cardId)]
				: Array.isArray(args.cardIds)
					? args.cardIds.map(String)
					: [];
			const whiteboardId = String(args.whiteboardId) as WhiteboardId;
			const results: Array<{
				cardId: string;
				itemId: string;
				shapeId: string;
				whiteboardId: WhiteboardId;
				created: boolean;
			}> = [];
			for (const cardId of cardIds) {
				const existing = (
					await db.boardItems.where("cardId").equals(cardId).toArray()
				).find((row) => active(row) && row.whiteboardId === whiteboardId);
				const itemId = id();
				const shapeId =
					typeof args.shapeId === "string"
						? args.shapeId
						: `shape:card-${cardId}-${now}-${results.length}`;
				const plan = planAppendCard(
					{
						card: existing ? null : ((await db.cards.get(cardId)) ?? null),
						existingPlacement: existing ?? null,
					},
					{
						whiteboardId,
						itemId,
						shapeId,
						x: Number(args.x ?? 0),
						y: Number(args.y ?? 0),
						w: Number(args.w ?? DEFAULT_CARD_WIDTH),
						h: Number(args.h ?? 180),
						rotation: Number(args.rotation ?? 0),
						zIndex: now + results.length,
					},
					{ now, deviceId },
				);
				for (const write of plan.writes) {
					if (write.entity === "boardItem")
						await db.boardItems.add({
							...(write.value as BoardItem),
							revision: 1,
						});
					else if (write.entity === "card")
						await db.cards.update(write.id, {
							...(write.value as Partial<Card>),
							updatedAt: now,
							revision: (write.expectedRevision ?? 0) + 1,
							updatedByDeviceId: deviceId,
						});
				}
				if (plan.result)
					results.push({
						...plan.result,
						cardId,
						whiteboardId,
					});
			}
			return single ? results[0] : { whiteboardId, placements: results };
		}
		case "canvas.restoreOrAdoptCardItem": {
			const whiteboardId =
				typeof args.whiteboardId === "string"
					? (args.whiteboardId as WhiteboardId)
					: null;
			if (!whiteboardId) return null;
			const board = await db.whiteboards.get(whiteboardId);
			if (!board || !active(board)) throw new Error("Whiteboard not found");

			const shapeId = String(args.shapeId);
			const existing = await db.boardItems
				.where("[whiteboardId+shapeId]")
				.equals([whiteboardId, shapeId])
				.first();
			const sourceIsTrusted =
				args.placement !== "duplicate" &&
				typeof args.sourceWorkspaceId === "string" &&
				args.sourceWorkspaceId === workspaceId;
			const source =
				sourceIsTrusted && typeof args.sourceCardId === "string"
					? await db.cards.get(args.sourceCardId)
					: null;
			const itemId = id();
			const cardId = id();
			const content = parseClipboardCardContent(args.content);
			const plan = planRestoreOrAdoptCardItem(
				{
					existingPlacement: existing ?? null,
					existingCard: existing?.cardId
						? ((await db.cards.get(existing.cardId)) ?? null)
						: null,
					sourceCard: source ?? null,
				},
				{
					whiteboardId,
					cardId,
					itemId,
					shapeId,
					content,
					x: Number(args.x ?? 0),
					y: Number(args.y ?? 0),
					w: Number(args.w ?? DEFAULT_CARD_WIDTH),
					h: Number(args.h ?? 180),
					rotation: Number(args.rotation ?? 0),
				},
				{ now, deviceId },
			);
			for (const write of plan.writes) {
				if (write.entity === "boardItem") {
					if (write.expectedRevision === undefined)
						await db.boardItems.add({
							...(write.value as BoardItem),
							revision: 1,
						});
					else
						await db.boardItems.update(write.id, {
							...(write.value as Partial<BoardItem>),
							updatedAt: now,
							revision: write.expectedRevision + 1,
							updatedByDeviceId: deviceId,
						});
				} else if (write.entity === "card") {
					if (write.expectedRevision === undefined)
						await db.cards.add({
							...(write.value as Card),
							revision: 1,
						});
					else
						await db.cards.update(write.id, {
							...(write.value as Partial<Card>),
							updatedAt: now,
							revision: write.expectedRevision + 1,
							updatedByDeviceId: deviceId,
						});
				}
			}
			if (plan.result.adoptedCardId)
				await reconcileReferences(
					db,
					deviceId,
					"card",
					plan.result.adoptedCardId,
					content,
				);
			return plan.result.itemId;
		}
		case "tldrawDocuments.save": {
			const whiteboardId = (args.whiteboardId ?? null) as WhiteboardId | null;
			const existing =
				whiteboardId === null
					? (await db.tldrawDocuments.toArray()).find(
							(entry) => entry.whiteboardId === null,
						)
					: await db.tldrawDocuments
							.where("whiteboardId")
							.equals(whiteboardId)
							.first();
			if (
				existing &&
				args.expectedRevision !== undefined &&
				args.expectedRevision !== existing.revision
			)
				throw new Error("Tldraw document was updated elsewhere");
			const revision = (existing?.revision ?? 0) + 1;
			const documentId = existing?.id ?? id();
			if (existing)
				await db.tldrawDocuments.update(existing.id, {
					snapshot: args.snapshot,
					revision,
					updatedAt: now,
				});
			else
				await db.tldrawDocuments.add({
					id: documentId as never,
					...base(deviceId, now),
					whiteboardId,
					snapshot: args.snapshot,
					documentVersion: 1,
					revision,
				});
			await reconcileReferences(
				db,
				deviceId,
				"tldrawDocument",
				documentId,
				args.snapshot,
			);
			return { revision, updatedAt: now };
		}
		case "files.generateUploadUrl":
			return "contextboard-local:";
		case "files.finalizeUpload": {
			const file = args.file;
			if (!(file instanceof Blob))
				throw new Error("Local upload is missing its file");
			const bytes = await waitForExternal(file.arrayBuffer());
			const digest = await waitForExternal(
				crypto.subtle.digest("SHA-256", bytes),
			);
			const sha256 = [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
			const existing = await db.files.where("sha256").equals(sha256).first();
			const fileId = existing?.id ?? id();
			if (!existing)
				await db.files.add({
					id: fileId as never,
					...base(deviceId, now),
					sha256,
					blob: file,
					contentType: file.type || "application/octet-stream",
					size: file.size,
					refCount: 0,
					status: "active",
					pendingDeleteAt: null,
				});
			return { fileId, storageId: fileId, url: await blobDataUrl(file) };
		}
		case "relations.create": {
			const whiteboardId = String(args.whiteboardId);
			const sourceCardId = String(args.sourceCardId);
			const targetCardId = String(args.targetCardId);
			const relation = String(args.relation) as CardRelationKind;
			const allowed: CardRelationKind[] = [
				"related",
				"next",
				"explains",
				"supports",
				"cites",
				"summarizes",
			];
			const ordinal =
				args.ordinal === null || args.ordinal === undefined
					? null
					: Number(args.ordinal);
			if (!allowed.includes(relation)) throw new Error("Invalid card relation");
			if (ordinal !== null && (!Number.isSafeInteger(ordinal) || ordinal < 0))
				throw new Error("Invalid relation ordinal");
			if (sourceCardId === targetCardId)
				throw new Error("A card cannot relate to itself");
			const [whiteboard, source, target] = await Promise.all([
				db.whiteboards.get(whiteboardId),
				db.cards.get(sourceCardId),
				db.cards.get(targetCardId),
			]);
			if (!whiteboard || !active(whiteboard))
				throw new Error("Whiteboard not found");
			if (!source || !active(source) || !target || !active(target))
				throw new Error("Card not found");
			const relationId = id();
			const relationClock = (
				clocks.get(deviceId) ?? new HybridLogicalClock(deviceId)
			).tick(now);
			await db.cardRelations.add({
				id: relationId as never,
				...base(deviceId, now),
				whiteboardId: whiteboardId as never,
				sourceCardId: sourceCardId as never,
				targetCardId: targetCardId as never,
				relation,
				ordinal,
				arrowShapeId: null,
				clock: relationClock,
			});
			return relationId;
		}
		case "relations.archive": {
			const relation = await db.cardRelations.get(String(args.relationId));
			if (!relation || relation.deletedAt !== null) return null;
			const relationClock = (
				clocks.get(deviceId) ?? new HybridLogicalClock(deviceId)
			).tick(now);
			await db.cardRelations.update(relation.id, {
				deletedAt: now,
				revision: relation.revision + 1,
				updatedAt: now,
				updatedByDeviceId: deviceId,
				clock: relationClock,
			});
			return null;
		}
		case "conflicts.resolve": {
			const conflictId = String(args.conflictId);
			const resolution = String(args.resolution) as
				| "keep-local"
				| "keep-remote"
				| "keep-both";
			if (!["keep-local", "keep-remote", "keep-both"].includes(resolution))
				throw new Error("Invalid conflict resolution");
			const conflict = await db.conflicts.get(conflictId);
			if (!conflict || conflict.resolvedAt !== null) return null;
			if (conflict.entityType === "card") {
				const original = await db.cards.get(conflict.entityId);
				if (
					original &&
					(resolution !== "keep-remote" ||
						(conflict.remoteValue && typeof conflict.remoteValue === "object"))
				) {
					const selected =
						resolution === "keep-remote"
							? (conflict.remoteValue as Card)
							: original;
					await db.cards.put({
						...selected,
						id: original.id,
						revision: original.revision + 1,
						updatedAt: now,
						updatedByDeviceId: deviceId,
					});
					await reconcileReferences(
						db,
						deviceId,
						"card",
						original.id,
						selected.content,
					);
				}
				const copy = await db.cards.get(conflictCopyCardId(conflictId));
				if (copy) {
					await reconcileReferences(
						db,
						deviceId,
						"card",
						copy.id,
						copy.content,
					);
					await db.cards.update(copy.id, {
						archivedAt: resolution === "keep-both" ? copy.archivedAt : now,
						revision: copy.revision + 1,
						updatedAt: now,
						updatedByDeviceId: deviceId,
					});
					if (resolution !== "keep-both") {
						for (const placement of await db.boardItems
							.where("cardId")
							.equals(copy.id)
							.toArray())
							await db.boardItems.update(placement.id, {
								archivedAt: now,
								revision: placement.revision + 1,
								updatedAt: now,
								updatedByDeviceId: deviceId,
							});
					}
				}
			}
			await db.conflicts.update(conflictId, {
				resolvedAt: now,
				resolution,
				revision: conflict.revision + 1,
				updatedAt: now,
				updatedByDeviceId: deviceId,
			});
			return null;
		}
		case "todos.add": {
			const row: Todo = {
				id: id(),
				text: String(args.text),
				completed: false,
				...base(deviceId, now),
			};
			await db.todos.add(row);
			return row.id;
		}
		case "todos.toggle": {
			const row = await db.todos.get(String(args.id));
			if (row)
				await db.todos.update(row.id, {
					completed: !row.completed,
					updatedAt: now,
					revision: row.revision + 1,
				});
			return null;
		}
		case "todos.remove": {
			await db.todos.delete(String(args.id));
			return null;
		}
		default:
			throw new Error(`Unsupported local mutation: ${reference}`);
	}
}

const clocks = new Map<string, HybridLogicalClock>();

type TrackableRow = {
	id?: string;
	conflictId?: string;
	revision?: number;
	deletedAt?: number | null;
	[key: string]: unknown;
};

function syncRowId(row: TrackableRow): string {
	const id = row.id ?? row.conflictId;
	if (!id) throw new Error("A syncable row is missing its entity ID");
	return id;
}

function syncValue(entityType: SyncEntityType, row: TrackableRow) {
	if (entityType === "file") {
		const { blob: _blob, sha256, ...rest } = row;
		return { ...rest, hash: sha256 };
	}
	if (entityType === "whiteboard") {
		const {
			cardCount: _cardCount,
			childWhiteboardCount: _childWhiteboardCount,
			...rest
		} = row;
		return rest;
	}
	return row;
}

export async function localMutation(
	db: ContextboardDatabase,
	deviceId: string,
	reference: string,
	args: Args = {},
): Promise<any> {
	const workspaceId = String(
		(await db.settings.get("workspaceId"))?.value ?? "local",
	);
	const clock = clocks.get(deviceId) ?? new HybridLogicalClock(deviceId);
	clocks.set(deviceId, clock);
	const tables = [
		db.whiteboards,
		db.cards,
		db.boardItems,
		db.tldrawDocuments,
		db.files,
		db.fileReferences,
		db.cardReferences,
		db.cardRelations,
		db.canvasRecords,
		db.conflicts,
		db.todos,
	];
	const tracked = [
		["whiteboard", db.whiteboards],
		["card", db.cards],
		["boardItem", db.boardItems],
		["file", db.files],
		["fileReference", db.fileReferences],
		["cardReference", db.cardReferences],
		["cardRelation", db.cardRelations],
		["canvasRecord", db.canvasRecords],
		["conflict", db.conflicts],
		["todo", db.todos],
	] as const;
	return runLocalCommand(
		db,
		{ workspaceId, deviceId, clock },
		reference,
		tables,
		async () => {
			const before = new Map<string, TrackableRow>();
			for (const [entityType, table] of tracked) {
				for (const row of (await table.toArray()) as TrackableRow[]) {
					before.set(`${entityType}:${syncRowId(row)}`, structuredClone(row));
				}
			}
			const result = await executeMutation(
				db,
				deviceId,
				workspaceId,
				reference,
				args,
			);
			const changes: EntityChange[] = [];
			const seen = new Set<string>();
			const now = Date.now();
			for (const [entityType, table] of tracked) {
				for (const row of (await table.toArray()) as TrackableRow[]) {
					const rowId = syncRowId(row);
					const key = `${entityType}:${rowId}`;
					seen.add(key);
					const previous = before.get(key);
					const value = syncValue(entityType, row);
					if (
						previous &&
						JSON.stringify(syncValue(entityType, previous)) ===
							JSON.stringify(value)
					)
						continue;
					changes.push({
						entityType,
						entityId: rowId,
						baseRevision: previous?.revision ?? null,
						revision: row.revision ?? (previous?.revision ?? 0) + 1,
						operation: row.deletedAt
							? ("delete" as const)
							: ("upsert" as const),
						clock: "",
						value,
					});
				}
			}
			for (const [key, previous] of before) {
				if (seen.has(key)) continue;
				const separator = key.indexOf(":");
				const entityType = key.slice(0, separator) as SyncEntityType;
				changes.push({
					entityType,
					entityId: syncRowId(previous),
					baseRevision: previous.revision ?? null,
					revision: (previous.revision ?? 0) + 1,
					operation: "delete" as const,
					clock: "",
					value: syncValue(entityType, {
						...previous,
						revision: (previous.revision ?? 0) + 1,
						deletedAt: now,
						updatedAt: now,
						updatedByDeviceId: deviceId,
					}),
				});
			}
			return {
				result,
				changes,
			};
		},
	);
}
