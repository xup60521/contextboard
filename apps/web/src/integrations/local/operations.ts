import {
	runLocalCommand,
	type ContextboardDatabase,
	type Todo,
} from "@contextboard/local-db";
import type {
	BoardItem,
	Card,
	CardId,
	Whiteboard,
	WhiteboardId,
} from "@contextboard/domain";
import {
	HybridLogicalClock,
	type SyncEntityType,
} from "@contextboard/sync-protocol";

type Args = Record<string, unknown>;
const DEFAULT_CARD_WIDTH = 576;
const DEFAULT_CARD_CONTENT = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "New card" }],
		},
	],
};
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

function metadata(content: unknown) {
	const rows: string[] = [];
	collectTextRows(content, rows);
	const normalizedRows = rows
		.map((row) => row.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	const plainText = normalizedRows.join("\n").slice(0, 10_000).trim();
	return {
		plainText,
		derivedTitle: normalizedRows[0]?.slice(0, 120) || "Untitled card",
		preview: plainText.slice(0, 400),
	};
}

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

function collectTextRows(value: unknown, rows: string[]) {
	if (!value || typeof value !== "object") return;
	const node = value as {
		type?: unknown;
		text?: unknown;
		attrs?: Record<string, unknown>;
		content?: unknown;
	};
	if (node.type === "text" && typeof node.text === "string") {
		rows.push(node.text);
		return;
	}
	if (node.type === "inlineMath" || node.type === "blockMath") {
		if (typeof node.attrs?.latex === "string") rows.push(node.attrs.latex);
		return;
	}
	if (!Array.isArray(node.content)) return;
	const children: string[] = [];
	for (const child of node.content) collectTextRows(child, children);
	if (
		node.type === "heading" ||
		node.type === "paragraph" ||
		node.type === "listItem" ||
		node.type === "blockquote" ||
		node.type === "codeBlock" ||
		node.type === "tableCell" ||
		node.type === "tableHeader"
	) {
		rows.push(children.join(" "));
	} else {
		rows.push(...children);
	}
}

function collectStringFields(
	value: unknown,
	field: "fileId" | "cardId",
	result = new Set<string>(),
): Set<string> {
	if (Array.isArray(value)) {
		for (const child of value) collectStringFields(child, field, result);
		return result;
	}
	if (!value || typeof value !== "object") return result;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key === field && typeof child === "string" && child) result.add(child);
		else collectStringFields(child, field, result);
	}
	return result;
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
	const nextFileIds = collectStringFields(content, "fileId");
	for (const ref of current)
		if (!nextFileIds.has(ref.fileId)) await db.fileReferences.delete(ref.id);
	for (const fileId of nextFileIds)
		if (!current.some((ref) => ref.fileId === fileId)) {
			const now = Date.now();
			await db.fileReferences.add({
				id: `${targetKey}:${fileId}` as never,
				...base(deviceId, now),
				fileId: fileId as never,
				targetKey,
				targetType,
			});
		}
	const affected = new Set([
		...current.map((ref) => ref.fileId),
		...nextFileIds,
	]);
	for (const fileId of affected) {
		const file = await db.files.get(fileId);
		if (!file) continue;
		const refCount = await db.fileReferences
			.where("fileId")
			.equals(fileId)
			.count();
		await db.files.update(file.id, {
			refCount,
			status: refCount > 0 ? "active" : "pending_delete",
			pendingDeleteAt: refCount > 0 ? null : Date.now(),
		});
	}
	if (targetType === "card") {
		const currentCards = await db.cardReferences
			.where("sourceCardId")
			.equals(targetId)
			.toArray();
		const nextCardIds = collectStringFields(content, "cardId");
		nextCardIds.delete(targetId);
		for (const ref of currentCards)
			if (!nextCardIds.has(ref.targetCardId))
				await db.cardReferences.delete(ref.id);
		for (const targetCardId of nextCardIds)
			if (!currentCards.some((ref) => ref.targetCardId === targetCardId)) {
				const now = Date.now();
				await db.cardReferences.add({
					id: `${targetId}:${targetCardId}` as never,
					...base(deviceId, now),
					sourceCardId: targetId as never,
					targetCardId: targetCardId as never,
				});
			}
	}
}

async function blobDataUrl(blob: Blob): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () =>
			reject(reader.error ?? new Error("Could not read local image"));
		reader.readAsDataURL(blob);
	});
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
			const rows = (await db.boardItems.toArray())
				.filter(
					(row) =>
						active(row) && row.whiteboardId === (args.whiteboardId ?? null),
				)
				.sort((a, b) => a.zIndex - b.zIndex);
			return Promise.all(
				rows.map(async (row) => {
					const card = row.cardId ? await db.cards.get(row.cardId) : null;
					const child = row.childWhiteboardId
						? await db.whiteboards.get(row.childWhiteboardId)
						: null;
					return {
						...publicRow(row),
						card:
							card && active(card)
								? {
										_id: card.id,
										derivedTitle: card.derivedTitle,
										preview: card.preview,
										version: card.contentVersion,
									}
								: null,
						childWhiteboard:
							child && active(child)
								? {
										_id: child.id,
										title: child.title,
										depth: child.depth,
										cardCount: child.cardCount,
										childWhiteboardCount: child.childWhiteboardCount,
									}
								: null,
					};
				}),
			);
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
			return row && active(row)
				? { ...publicRow(row), snapshot: row.snapshot, revision: row.revision }
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
			return row ? URL.createObjectURL(row.blob) : null;
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
async function adjustCounts(
	db: ContextboardDatabase,
	whiteboardId: string | null,
	cardDelta: number,
	childDelta = 0,
) {
	if (!whiteboardId) return;
	const board = await db.whiteboards.get(whiteboardId);
	if (board)
		await db.whiteboards.update(board.id, {
			cardCount: Math.max(0, board.cardCount + cardDelta),
			childWhiteboardCount: Math.max(
				0,
				board.childWhiteboardCount + childDelta,
			),
			updatedAt: Date.now(),
			revision: board.revision + 1,
		});
}

async function executeMutation(
	db: ContextboardDatabase,
	deviceId: string,
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
				...metadata(content),
				contentVersion: nextVersion,
				updatedAt: now,
				revision: row.revision + 1,
				updatedByDeviceId: deviceId,
			});
			await reconcileReferences(db, deviceId, "card", row.id, content);
			return nextVersion;
		}
		case "canvas.createCardItem": {
			const whiteboardId = String(args.whiteboardId) as WhiteboardId;
			const board = await db.whiteboards.get(whiteboardId);
			if (!board || !active(board)) throw new Error("Whiteboard not found");
			const cardId = id() as CardId;
			const content = args.content ?? DEFAULT_CARD_CONTENT;
			const card: Card = {
				id: cardId,
				...base(deviceId, now),
				...metadata(content),
				content,
				contentVersion: 1,
				activePlacementCount: 1,
				archivedAt: null,
			};
			const itemId = id();
			const item: BoardItem = {
				id: itemId as BoardItem["id"],
				...base(deviceId, now),
				whiteboardId,
				kind: "card",
				cardId,
				childWhiteboardId: null,
				shapeId: String(args.shapeId),
				x: Number(args.x ?? 0),
				y: Number(args.y ?? 0),
				w: Number(args.w ?? DEFAULT_CARD_WIDTH),
				h: Number(args.h ?? 180),
				rotation: Number(args.rotation ?? 0),
				zIndex: now,
				archivedAt: null,
			};
			await db.cards.add(card);
			await db.boardItems.add(item);
			await adjustCounts(db, whiteboardId, 1);
			await reconcileReferences(db, deviceId, "card", cardId, content);
			return { itemId, cardId };
		}
		case "canvas.createSubwhiteboardItem": {
			const parentId = (args.parentWhiteboardId ?? null) as WhiteboardId | null;
			const parent = parentId ? await db.whiteboards.get(parentId) : null;
			const boardId = id() as WhiteboardId;
			const sortKey = `${String(parent?.childWhiteboardCount ?? 0).padStart(10, "0")}-${now.toString(36)}`;
			const board: Whiteboard = {
				id: boardId,
				...base(deviceId, now),
				title: "Untitled whiteboard",
				parentWhiteboardId: parentId,
				ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
				depth: (parent?.depth ?? -1) + 1,
				sortKey,
				pathKey: parent ? `${parent.pathKey}/${sortKey}` : sortKey,
				cardCount: 0,
				childWhiteboardCount: 0,
				archivedAt: null,
			};
			const itemId = id();
			const item: BoardItem = {
				id: itemId as BoardItem["id"],
				...base(deviceId, now),
				whiteboardId: parentId,
				kind: "subwhiteboard",
				cardId: null,
				childWhiteboardId: boardId,
				shapeId: String(args.shapeId),
				x: Number(args.x ?? 0),
				y: Number(args.y ?? 0),
				w: Number(args.w ?? 320),
				h: Number(args.h ?? 180),
				rotation: Number(args.rotation ?? 0),
				zIndex: now,
				archivedAt: null,
			};
			await db.transaction("rw", db.whiteboards, db.boardItems, async () => {
				await db.whiteboards.add(board);
				await db.boardItems.add(item);
				await adjustCounts(db, parentId, 0, 1);
			});
			return { itemId, childWhiteboardId: boardId };
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
		case "canvas.archiveItem": {
			const row = await db.boardItems.get(String(args.itemId));
			if (!row || !active(row)) return null;
			await db.boardItems.update(row.id, {
				archivedAt: now,
				updatedAt: now,
				revision: row.revision + 1,
			});
			if (row.cardId) {
				const card = await db.cards.get(row.cardId);
				if (card) {
					const count = Math.max(0, card.activePlacementCount - 1);
					await db.cards.update(card.id, {
						activePlacementCount: count,
						archivedAt: args.deleteCards && count === 0 ? now : card.archivedAt,
						updatedAt: now,
						revision: card.revision + 1,
					});
				}
				await adjustCounts(db, row.whiteboardId, -1);
			} else await adjustCounts(db, row.whiteboardId, 0, -1);
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
				db.whiteboards,
				async () => {
					for (const cardId of ids) {
						const card = await db.cards.get(cardId);
						if (!card) continue;
						const placements = (
							await db.boardItems.where("cardId").equals(cardId).toArray()
						).filter(active);
						for (const placement of placements) {
							await db.boardItems.update(placement.id, {
								archivedAt: now,
								updatedAt: now,
							});
							await adjustCounts(db, placement.whiteboardId, -1);
						}
						await db.cards.update(card.id, {
							archivedAt: now,
							activePlacementCount: 0,
							updatedAt: now,
							revision: card.revision + 1,
						});
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
				if (existing) {
					results.push({
						cardId,
						itemId: existing.id,
						shapeId: existing.shapeId,
						whiteboardId,
						created: false,
					});
					continue;
				}
				const card = await db.cards.get(cardId);
				if (!card) continue;
				const itemId = id();
				const shapeId =
					typeof args.shapeId === "string"
						? args.shapeId
						: `shape:card-${cardId}-${now}-${results.length}`;
				await db.boardItems.add({
					id: itemId as BoardItem["id"],
					...base(deviceId, now),
					whiteboardId,
					kind: "card",
					cardId: card.id,
					childWhiteboardId: null,
					shapeId,
					x: Number(args.x ?? 0),
					y: Number(args.y ?? 0),
					w: Number(args.w ?? DEFAULT_CARD_WIDTH),
					h: Number(args.h ?? 180),
					rotation: Number(args.rotation ?? 0),
					zIndex: now + results.length,
					archivedAt: null,
				});
				await db.cards.update(card.id, {
					activePlacementCount: card.activePlacementCount + 1,
					updatedAt: now,
				});
				await adjustCounts(db, whiteboardId, 1);
				results.push({ cardId, itemId, shapeId, whiteboardId, created: true });
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
			if (existing) {
				if (active(existing)) return existing.id;
				if (existing.kind !== "card" || !existing.cardId) return null;
				const card = await db.cards.get(existing.cardId);
				if (!card) throw new Error("Card not found");
				await db.boardItems.update(existing.id, {
					archivedAt: null,
					updatedAt: now,
					revision: existing.revision + 1,
					updatedByDeviceId: deviceId,
				});
				await db.cards.update(card.id, {
					archivedAt: null,
					activePlacementCount: card.activePlacementCount + 1,
					updatedAt: now,
					revision: card.revision + 1,
					updatedByDeviceId: deviceId,
				});
				await adjustCounts(db, whiteboardId, 1);
				return existing.id;
			}

			const source =
				typeof args.sourceCardId === "string"
					? await db.cards.get(args.sourceCardId)
					: null;
			if (source && active(source)) {
				const itemId = id();
				await db.boardItems.add({
					id: itemId as BoardItem["id"],
					...base(deviceId, now),
					whiteboardId,
					kind: "card",
					cardId: source.id,
					childWhiteboardId: null,
					shapeId,
					x: Number(args.x ?? 0),
					y: Number(args.y ?? 0),
					w: Number(args.w ?? DEFAULT_CARD_WIDTH),
					h: Number(args.h ?? 180),
					rotation: Number(args.rotation ?? 0),
					zIndex: now,
					archivedAt: null,
				});
				await db.cards.update(source.id, {
					activePlacementCount: source.activePlacementCount + 1,
					updatedAt: now,
					revision: source.revision + 1,
					updatedByDeviceId: deviceId,
				});
				await adjustCounts(db, whiteboardId, 1);
				return itemId;
			}

			const adopted = await executeMutation(
				db,
				deviceId,
				"canvas.createCardItem",
				{
				...args,
				whiteboardId,
				shapeId,
				content: parseClipboardCardContent(args.content),
				},
			);
			return adopted.itemId;
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
			const bytes = await file.arrayBuffer();
			const digest = await crypto.subtle.digest("SHA-256", bytes);
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
const entityTypeFor = (reference: string): SyncEntityType =>
	reference.startsWith("whiteboards.")
		? "whiteboard"
		: reference.startsWith("canvas.")
			? "boardItem"
			: reference.startsWith("tldrawDocuments.")
				? "tldrawDocument"
				: reference.startsWith("files.")
					? "file"
					: reference.startsWith("todos.")
						? "todo"
						: "card";

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
		db.todos,
	];
	return runLocalCommand(
		db,
		{ workspaceId, deviceId, clock },
		reference,
		tables,
		async () => {
			const result = await executeMutation(db, deviceId, reference, args);
			const entityId = String(
				args.cardId ??
					args.whiteboardId ??
					args.itemId ??
					args.id ??
					(result && typeof result === "object" && "cardId" in result
						? result.cardId
						: crypto.randomUUID()),
			);
			return {
				result,
				changes: [
					{
						entityType: entityTypeFor(reference),
						entityId,
						baseRevision: null,
						revision: 1,
						operation: reference.endsWith("remove") ? "delete" : "upsert",
						changedFields: Object.keys(args),
						value: args,
					},
				],
			};
		},
	);
}
