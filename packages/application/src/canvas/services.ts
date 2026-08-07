import type { WorkspaceRepository } from "@contextboard/client-core";
import {
	DEFAULT_CARD_CONTENT,
	normalizeCardContent,
} from "../cards/card-content";
import { estimateCardHeight } from "../cards/estimate-card-height";
import { normalizeImageSources } from "../files/fileUrl";
import {
	applyWrites,
	type EntityRow,
	getRow,
	isActiveRow,
	listRows,
} from "../repository/entities";
import type {
	CanvasItem,
	CanvasItemFrameUpdate,
	CanvasRecordDelta,
	CanvasRecordSaveResult,
	CanvasService,
	CreateCardItemResult,
	CreateSubwhiteboardResult,
	TldrawDocument,
	TldrawSaveResult,
	WhiteboardArchiveOptions,
	WhiteboardDetail,
	WhiteboardSummary,
	WhiteboardsService,
} from "../runtime";
import { withRetry } from "../workspace";
import { deriveWhiteboardCounts } from "./derive/counts";
import { planArchiveItem } from "./plan/archive-item";
import { planArchiveWhiteboardTree } from "./plan/archive-whiteboard-tree";
import { planCreateCardItem } from "./plan/create-card-item";
import { planCreateSubwhiteboard } from "./plan/create-subwhiteboard";
import { planReferences } from "./plan/references";
import { planRestoreOrAdoptCardItem } from "./plan/restore-or-adopt-card-item";

const DEFAULT_CARD_WIDTH = 576;
const DEFAULT_CARD_HEIGHT = 180;
const DEFAULT_SUBWHITEBOARD_WIDTH = 320;
const DEFAULT_ROOT_TITLE = "Untitled whiteboard";

type ServiceOptions = {
	now?: () => number;
	createId?: () => string;
	deviceId?: string;
	workspaceId?: string;
};

function resolve(options: ServiceOptions) {
	return {
		now: options.now ?? (() => Date.now()),
		createId: options.createId ?? (() => crypto.randomUUID()),
		deviceId: options.deviceId ?? "",
		workspaceId: options.workspaceId ?? "",
	};
}

function toSummary(
	board: EntityRow,
	items: EntityRow[],
	boards: EntityRow[],
): WhiteboardSummary {
	return {
		id: board.id,
		title: typeof board.title === "string" ? board.title : "",
		parentWhiteboardId:
			typeof board.parentWhiteboardId === "string"
				? board.parentWhiteboardId
				: null,
		ancestorIds: Array.isArray(board.ancestorIds)
			? board.ancestorIds.map(String)
			: [],
		depth: typeof board.depth === "number" ? board.depth : 0,
		createdAt: board.createdAt,
		updatedAt: board.updatedAt,
		...deriveWhiteboardCounts(board.id, items as never[], boards as never[]),
	};
}

function normalizeTitle(value: unknown) {
	return (
		String(value ?? "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 120) || DEFAULT_ROOT_TITLE
	);
}

/** Reads the `boardItem` and `whiteboard` tables the canvas planners need. */
async function readBoardSnapshot(repository: WorkspaceRepository) {
	const [items, boards] = await Promise.all([
		listRows(repository, "items"),
		listRows(repository, "whiteboards"),
	]);
	return {
		items: items.filter(isActiveRow),
		boards: boards.filter(isActiveRow),
	};
}

/** Reads only the rows needed to render one whiteboard's metadata. */
async function readWhiteboardDetail(
	repository: WorkspaceRepository,
	id: string,
): Promise<WhiteboardDetail | null> {
	const board = await getRow(repository, "whiteboards", id);
	if (!board || !isActiveRow(board)) return null;

	const items = (
		await listRows(repository, "items", { whiteboardId: id })
	).filter(isActiveRow);
	const ancestorIds = Array.isArray(board.ancestorIds)
		? board.ancestorIds.map(String)
		: [];
	const childWhiteboardIds = items
		.filter((item) => item.kind === "subwhiteboard")
		.map((item) => item.childWhiteboardId)
		.filter((childId): childId is string => typeof childId === "string");
	const relatedBoardIds = [
		...new Set([id, ...ancestorIds, ...childWhiteboardIds]),
	];
	const relatedBoards = await listRows(repository, "whiteboards", {
		ids: relatedBoardIds,
	});
	const boards = [board, ...relatedBoards.filter(isActiveRow)];
	const summary = toSummary(board, items, boards);
	const boardById = new Map(boards.map((entry) => [entry.id, entry]));

	return {
		...summary,
		breadcrumbs: [...summary.ancestorIds, board.id]
			.map((entry) => boardById.get(entry))
			.filter((entry): entry is EntityRow => !!entry)
			.map((entry) => ({
				id: entry.id,
				title: typeof entry.title === "string" ? entry.title : "",
			})),
	};
}

async function archiveWhiteboardTree(
	repository: WorkspaceRepository,
	options: ServiceOptions,
	whiteboardId: string,
	archiveOptions: WhiteboardArchiveOptions = {},
): Promise<boolean> {
	const { now } = resolve(options);
	return withRetry(async () => {
		const [
			whiteboards,
			items,
			cards,
			tldrawDocuments,
			canvasRecords,
			fileReferences,
			files,
			cardRelations,
		] = await Promise.all([
			listRows(repository, "whiteboards"),
			listRows(repository, "items"),
			listRows(repository, "cards"),
			listRows(repository, "tldrawDocuments"),
			listRows(repository, "records"),
			listRows(repository, "fileReferences"),
			listRows(repository, "files"),
			listRows(repository, "cardRelations"),
		]);
		const plan = planArchiveWhiteboardTree(
			{
				whiteboards,
				items,
				cards,
				tldrawDocuments,
				canvasRecords,
				fileReferences,
				files,
				cardRelations,
			},
			{
				whiteboardId,
				deleteCards: archiveOptions.deleteCards === true,
				now: now(),
			},
		);
		if (plan.writes.length === 0) return false;
		await applyWrites(repository, "whiteboards.archiveTree", plan.writes);
		return true;
	});
}

export function createRepositoryWhiteboardsService(
	repository: WorkspaceRepository,
	options: ServiceOptions = {},
): WhiteboardsService {
	const { now, createId, deviceId } = resolve(options);

	return {
		async list() {
			const { items, boards } = await readBoardSnapshot(repository);
			return boards
				.map((board) => toSummary(board, items, boards))
				.sort((a, b) => a.title.localeCompare(b.title));
		},

		async get(id: string): Promise<WhiteboardDetail | null> {
			return readWhiteboardDetail(repository, id);
		},

		async createRoot() {
			const timestamp = now();
			const value = {
				id: createId(),
				createdAt: timestamp,
				updatedAt: timestamp,
				updatedByDeviceId: deviceId,
				deletedAt: null,
				archivedAt: null,
				title: DEFAULT_ROOT_TITLE,
				parentWhiteboardId: null,
				ancestorIds: [],
				depth: 0,
				sortKey: timestamp.toString(36),
				pathKey: timestamp.toString(36),
			};
			await repository.execute({
				type: "whiteboards.create",
				input: { value },
			});
			return value.id;
		},

		async createSubwhiteboard(input) {
			return createSubwhiteboardItem(repository, options, input);
		},

		async rename({ whiteboardId, title }) {
			const row = await getRow(repository, "whiteboards", whiteboardId);
			if (!row || !isActiveRow(row)) throw new Error("Whiteboard not found");
			const next = normalizeTitle(title);
			await repository.execute({
				type: "whiteboards.update",
				input: {
					value: {
						...row,
						title: next,
						updatedAt: now(),
						updatedByDeviceId: deviceId,
					},
				},
			});
			return next;
		},

		async archive(id: string, archiveOptions = {}) {
			await archiveWhiteboardTree(repository, options, id, archiveOptions);
		},

		subscribe(listener: () => void, options?: { whiteboardIds?: string[] }) {
			return repository.subscribe(() => listener(), {
				entityTypes: ["whiteboard", "boardItem"],
				...(options?.whiteboardIds
					? { whiteboardIds: options.whiteboardIds }
					: {}),
			});
		},
	};
}

async function createSubwhiteboardItem(
	repository: WorkspaceRepository,
	options: ServiceOptions,
	input: {
		parentWhiteboardId: string | null;
		shapeId: string;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		rotation?: number;
	},
): Promise<CreateSubwhiteboardResult> {
	const { now, createId, deviceId } = resolve(options);
	return withRetry(async () => {
		const { boards } = await readBoardSnapshot(repository);
		const parent = input.parentWhiteboardId
			? (boards.find((row) => row.id === input.parentWhiteboardId) ?? null)
			: null;
		if (input.parentWhiteboardId && !parent) {
			throw new Error(`Whiteboard not found: ${input.parentWhiteboardId}`);
		}
		const timestamp = now();
		const plan = planCreateSubwhiteboard(
			{
				parent: parent
					? {
							id: parent.id,
							ancestorIds: Array.isArray(parent.ancestorIds)
								? parent.ancestorIds.map(String)
								: [],
							depth: typeof parent.depth === "number" ? parent.depth : 0,
							pathKey: String(parent.pathKey ?? ""),
						}
					: null,
				activeChildCount: parent
					? boards.filter((row) => row.parentWhiteboardId === parent.id).length
					: 0,
			},
			{
				boardId: createId(),
				itemId: createId(),
				shapeId: input.shapeId,
				x: input.x ?? 0,
				y: input.y ?? 0,
				w: input.w ?? DEFAULT_SUBWHITEBOARD_WIDTH,
				h: input.h ?? DEFAULT_CARD_HEIGHT,
				rotation: input.rotation ?? 0,
			},
			{ now: timestamp, deviceId },
		);
		await applyWrites(repository, "whiteboards.create", plan.writes);
		return plan.result;
	});
}

export function createRepositoryCanvasService(
	repository: WorkspaceRepository,
	options: ServiceOptions = {},
): CanvasService {
	const { now, createId, deviceId, workspaceId } = resolve(options);

	/** Mirrors the Web reference reconciliation for canvas-owned content. */
	async function reconcileReferences(
		targetType: "card" | "tldrawDocument",
		targetId: string,
		content: unknown,
	) {
		const [fileReferences, cardReferences, files] = await Promise.all([
			listRows(repository, "fileReferences"),
			listRows(repository, "cardReferences"),
			listRows(repository, "files"),
		]);
		const targetKey = `${targetType}:${targetId}`;
		const plan = planReferences(
			{
				targetFileReferences: fileReferences.filter(
					(row) => row.targetKey === targetKey,
				) as never[],
				allFileReferences: fileReferences as never[],
				cardReferences:
					targetType === "card"
						? (cardReferences.filter(
								(row) => row.sourceCardId === targetId,
							) as never[])
						: [],
				files: files as never[],
			},
			{ targetType, targetId, content },
			{ now: now(), deviceId },
		);
		await applyWrites(repository, "cardReferences.update", plan.writes);
	}

	async function readDocumentRow(whiteboardId: string | null) {
		const rows = await listRows(repository, "tldrawDocuments", {
			whiteboardId,
		});
		return (
			rows.find(
				(row) =>
					isActiveRow(row) && (row.whiteboardId ?? null) === whiteboardId,
			) ?? null
		);
	}

	/** Active and tombstoned records for a board, keyed by tldraw record id. */
	async function readRecordRows(whiteboardId: string | null) {
		if (whiteboardId === null) return [];
		const rows = await listRows(repository, "records", { whiteboardId });
		return rows.filter((row) => (row.whiteboardId ?? null) === whiteboardId);
	}

	function recordIdOf(payload: unknown) {
		return payload &&
			typeof payload === "object" &&
			"id" in payload &&
			typeof (payload as { id: unknown }).id === "string"
			? (payload as { id: string }).id
			: null;
	}

	async function applyItemFrameUpdates(
		updates: CanvasItemFrameUpdate[],
	): Promise<void> {
		if (updates.length === 0) return;

		const itemIds = new Set<string>();
		for (const update of updates) {
			if (itemIds.has(update.itemId)) {
				throw new Error(
					`A frame batch cannot update the same item twice: ${update.itemId}`,
				);
			}
			itemIds.add(update.itemId);
		}

		await withRetry(async () => {
			const timestamp = now();
			const rows = await Promise.all(
				updates.map((update) => getRow(repository, "items", update.itemId)),
			);
			const writes: Parameters<typeof applyWrites>[2] = [];

			for (const [index, update] of updates.entries()) {
				const row = rows[index];
				if (!row) throw new Error(`Item not found: ${update.itemId}`);

				writes.push({
					entity: "boardItem",
					operation: "upsert",
					id: row.id,
					value: {
						...row,
						x: update.x,
						y: update.y,
						w: update.w,
						h: update.h,
						rotation: update.rotation,
						zIndex: update.zIndex,
						updatedAt: timestamp,
						updatedByDeviceId: deviceId,
					},
					expectedRevision: row.revision,
				});
			}

			await applyWrites(repository, "items.update", writes);
		});
	}

	return {
		async listItems(whiteboardId: string | null): Promise<CanvasItem[]> {
			const items = await listRows(repository, "items", { whiteboardId });
			const activeItems = items.filter(isActiveRow);
			const cardIds = [
				...new Set(
					activeItems
						.filter((item) => item.kind === "card")
						.map((item) => item.cardId)
						.filter((cardId): cardId is string => typeof cardId === "string"),
				),
			];
			const childWhiteboardIds = [
				...new Set(
					activeItems
						.filter((item) => item.kind === "subwhiteboard")
						.map((item) => item.childWhiteboardId)
						.filter(
							(childId): childId is string => typeof childId === "string",
						),
				),
			];
			const [boards, cards, childItems, grandchildBoards] = await Promise.all([
				listRows(repository, "whiteboards", { ids: childWhiteboardIds }),
				listRows(repository, "cards", { ids: cardIds }),
				listRows(repository, "items", {
					whiteboardIds: childWhiteboardIds,
				}),
				listRows(repository, "whiteboards", {
					parentWhiteboardIds: childWhiteboardIds,
				}),
			]);
			const activeBoards = boards.filter(isActiveRow);
			const activeChildItems = childItems.filter(isActiveRow);
			const activeGrandchildBoards = grandchildBoards.filter(isActiveRow);
			const cardById = new Map(
				cards.filter(isActiveRow).map((card) => [card.id, card]),
			);
			const boardById = new Map(activeBoards.map((board) => [board.id, board]));
			return activeItems
				.filter((item) => (item.whiteboardId ?? null) === whiteboardId)
				.sort(
					(a, b) =>
						(typeof a.zIndex === "number" ? a.zIndex : 0) -
						(typeof b.zIndex === "number" ? b.zIndex : 0),
				)
				.map((item) => {
					const card =
						typeof item.cardId === "string"
							? (cardById.get(item.cardId) ?? null)
							: null;
					const child =
						typeof item.childWhiteboardId === "string"
							? (boardById.get(item.childWhiteboardId) ?? null)
							: null;
					return {
						id: item.id,
						whiteboardId:
							typeof item.whiteboardId === "string" ? item.whiteboardId : null,
						kind: item.kind === "subwhiteboard" ? "subwhiteboard" : "card",
						cardId: typeof item.cardId === "string" ? item.cardId : null,
						childWhiteboardId:
							typeof item.childWhiteboardId === "string"
								? item.childWhiteboardId
								: null,
						shapeId: String(item.shapeId ?? ""),
						x: Number(item.x ?? 0),
						y: Number(item.y ?? 0),
						w: Number(item.w ?? 0),
						h: Number(item.h ?? 0),
						rotation: Number(item.rotation ?? 0),
						zIndex: Number(item.zIndex ?? 0),
						revision: item.revision,
						createdAt: item.createdAt,
						updatedAt: item.updatedAt,
						card: card
							? {
									id: card.id,
									title: String(card.derivedTitle ?? ""),
									preview: String(card.preview ?? ""),
									version: Number(card.contentVersion ?? 1),
								}
							: null,
						childWhiteboard: child
							? {
									id: child.id,
									title: typeof child.title === "string" ? child.title : "",
									depth: typeof child.depth === "number" ? child.depth : 0,
									...deriveWhiteboardCounts(
										child.id,
										activeChildItems as never[],
										activeGrandchildBoards as never[],
									),
								}
							: null,
					};
				});
		},

		async createCardItem(input): Promise<CreateCardItemResult> {
			const board = await getRow(repository, "whiteboards", input.whiteboardId);
			if (!board || !isActiveRow(board))
				throw new Error("Whiteboard not found");
			const content = normalizeImageSources(
				input.content ?? DEFAULT_CARD_CONTENT,
			);
			const width = input.w ?? DEFAULT_CARD_WIDTH;
			const plan = planCreateCardItem(
				{
					whiteboardId: input.whiteboardId,
					cardId: createId(),
					itemId: createId(),
					shapeId: input.shapeId,
					content,
					x: input.x ?? 0,
					y: input.y ?? 0,
					w: width,
					h: input.h ?? estimateCardHeight(content, width),
					rotation: input.rotation ?? 0,
				},
				{ now: now(), deviceId },
			);
			await applyWrites(repository, "cards.create", plan.writes);
			await reconcileReferences("card", plan.result.cardId, content);
			return plan.result;
		},

		createSubwhiteboardItem(input) {
			return createSubwhiteboardItem(repository, options, input);
		},

		async restoreOrAdoptCardItem(input) {
			if (!input.whiteboardId) return null;
			const whiteboardId = input.whiteboardId;
			const board = await getRow(repository, "whiteboards", whiteboardId);
			if (!board || !isActiveRow(board))
				throw new Error("Whiteboard not found");
			// A pasted or duplicated shape hands over its serialized props, so the
			// document arrives as a JSON string and must be parsed before it is
			// stored.
			const content = normalizeImageSources(
				normalizeCardContent(input.content),
			);
			const restoredWidth = input.w ?? DEFAULT_CARD_WIDTH;
			const result = await withRetry(async () => {
				const [items, cards] = await Promise.all([
					listRows(repository, "items"),
					listRows(repository, "cards"),
				]);
				const cardById = new Map(cards.map((card) => [card.id, card]));
				const existing =
					items.find(
						(item) =>
							(item.whiteboardId ?? null) === whiteboardId &&
							item.shapeId === input.shapeId,
					) ?? null;
				const placement = input.placement ?? "auto";
				const sourceIsTrusted =
					placement !== "duplicate" &&
					workspaceId.length > 0 &&
					input.sourceWorkspaceId === workspaceId;
				const plan = planRestoreOrAdoptCardItem(
					{
						existingPlacement: existing as never,
						existingCard:
							existing && typeof existing.cardId === "string"
								? ((cardById.get(existing.cardId) ?? null) as never)
								: null,
						sourceCard:
							sourceIsTrusted && typeof input.sourceCardId === "string"
								? ((cardById.get(input.sourceCardId) ?? null) as never)
								: null,
					},
					{
						whiteboardId,
						cardId: createId(),
						itemId: createId(),
						shapeId: input.shapeId,
						content,
						x: input.x ?? 0,
						y: input.y ?? 0,
						w: restoredWidth,
						h: input.h ?? estimateCardHeight(content, restoredWidth),
						rotation: input.rotation ?? 0,
					},
					{ now: now(), deviceId },
				);
				await applyWrites(repository, "items.create", plan.writes);
				return plan.result;
			});
			if (result.adoptedCardId)
				await reconcileReferences("card", result.adoptedCardId, content);
			return result.itemId;
		},

		updateItemFrame(input) {
			return applyItemFrameUpdates([input]);
		},

		updateItemFrames({ updates }) {
			return applyItemFrameUpdates(updates);
		},

		async archiveItem({ itemId, deleteCards }) {
			await withRetry(async () => {
				const row = await getRow(repository, "items", itemId);
				if (!row || !isActiveRow(row)) return;
				if (
					row.kind === "subwhiteboard" &&
					typeof row.childWhiteboardId === "string"
				) {
					const archived = await archiveWhiteboardTree(
						repository,
						options,
						row.childWhiteboardId,
						{ deleteCards },
					);
					if (archived) return;
				}
				const [card, relations] = await Promise.all([
					typeof row.cardId === "string"
						? getRow(repository, "cards", row.cardId)
						: Promise.resolve(null),
					listRows(repository, "cardRelations"),
				]);
				const plan = planArchiveItem(
					{
						item: row as never,
						card: card as never,
						relations: relations.filter(isActiveRow) as never[],
					},
					{ deleteCards },
					{ now: now() },
				);
				await applyWrites(repository, "items.delete", plan.writes);
			});
		},

		async saveDocument({
			whiteboardId,
			snapshot,
			expectedRevision,
		}): Promise<TldrawSaveResult> {
			const timestamp = now();
			const existing = await readDocumentRow(whiteboardId);
			if (
				existing &&
				expectedRevision !== undefined &&
				expectedRevision !== existing.revision
			)
				throw new Error("Tldraw document was updated elsewhere");
			const documentId = existing?.id ?? createId();
			await applyWrites(repository, "tldrawDocuments.update", [
				{
					entity: "tldrawDocument",
					operation: "upsert",
					id: documentId,
					value: {
						...(existing ?? {
							createdAt: timestamp,
							documentVersion: 1,
							storageMode: "legacy-snapshot",
						}),
						id: documentId,
						whiteboardId,
						snapshot,
						updatedAt: timestamp,
						updatedByDeviceId: deviceId,
						deletedAt: null,
					},
					...(existing ? { expectedRevision: existing.revision } : {}),
				},
			]);
			await reconcileReferences("tldrawDocument", documentId, snapshot);
			return { revision: (existing?.revision ?? 0) + 1, updatedAt: timestamp };
		},

		async getDocument(
			whiteboardId: string | null,
		): Promise<TldrawDocument | null> {
			const [row, recordRows] = await Promise.all([
				readDocumentRow(whiteboardId),
				readRecordRows(whiteboardId),
			]);

			// Once a board has per-record rows they are the source of truth; the
			// legacy whole-snapshot row only still supplies the store schema.
			if (row?.storageMode === "records-v1" || recordRows.length > 0) {
				const active = recordRows.filter(isActiveRow);
				const legacy = row?.snapshot as
					| { schema?: unknown; store?: Record<string, unknown> }
					| undefined;
				return {
					id: row?.id ?? null,
					whiteboardId,
					snapshot: {
						schema: row?.schema ?? legacy?.schema ?? null,
						store: Object.fromEntries(
							active.map((record) => [record.recordId, record.payload]),
						),
					},
					revision: Math.max(
						0,
						...active.map((record) => record.revision as number),
					),
					updatedAt: row?.updatedAt ?? 0,
					canvasRecordVersions: Object.fromEntries(
						recordRows.map((record) => [record.recordId, record.revision]),
					),
				};
			}

			if (!row) return null;
			return {
				id: row.id,
				whiteboardId,
				snapshot: row.snapshot ?? null,
				revision: row.revision,
				updatedAt: row.updatedAt,
			};
		},

		async applyRecordChanges({
			whiteboardId,
			added,
			updated,
			removed,
		}: CanvasRecordDelta & {
			whiteboardId: string | null;
		}): Promise<CanvasRecordSaveResult> {
			if (!whiteboardId) throw new Error("Canvas records require a whiteboard");

			return withRetry(async () => {
				const timestamp = now();
				const existing = new Map(
					(await readRecordRows(whiteboardId)).map((row) => [
						row.recordId as string,
						row,
					]),
				);
				const writes: Parameters<typeof applyWrites>[2] = [];
				const versions: Record<string, number> = {};
				const clock = `${String(timestamp).padStart(13, "0")}:000000:${deviceId}`;
				const incomingUpserts = new Map<string, unknown>();
				for (const rawPayload of [...added, ...updated]) {
					const payload = normalizeImageSources(rawPayload);
					const id = recordIdOf(payload);
					if (id) incomingUpserts.set(id, payload);
				}
				const incomingRemovals = new Set(removed);
				const legacy = await readDocumentRow(whiteboardId);
				if (legacy?.storageMode !== "records-v1") {
					const documentId = legacy?.id ?? createId();
					const legacyRecord = legacy as
						| (typeof legacy & { snapshot?: unknown; schema?: unknown })
						| null;
					const legacySnapshot = legacyRecord?.snapshot as
						| { schema?: unknown }
						| undefined;
					const { snapshot: _discardedSnapshot, ...legacyMetadata } =
						legacyRecord ?? {};
					writes.push({
						entity: "tldrawDocument",
						operation: "upsert",
						id: documentId,
						value: {
							...(legacy
								? legacyMetadata
								: {
								id: documentId,
								whiteboardId,
								documentVersion: 1,
								createdAt: timestamp,
								}),
							schema: legacySnapshot?.schema ?? legacyRecord?.schema ?? null,
							storageMode: "records-v1",
							updatedAt: timestamp,
							updatedByDeviceId: deviceId,
							deletedAt: null,
						},
						...(legacy ? { expectedRevision: legacy.revision } : {}),
					});
				}

				if (existing.size === 0) {
					const store = (
						legacy?.snapshot as { store?: Record<string, unknown> } | undefined
					)?.store;
					if (store && typeof store === "object") {
						const migrating = new Map<string, unknown>();
						for (const rawPayload of Object.values(store)) {
							const payload = normalizeImageSources(rawPayload);
							const id = recordIdOf(payload);
							if (!id || !payload || typeof payload !== "object") continue;
							const record = payload as { type?: unknown };
							if (
								record.type === "markdown-card" ||
								record.type === "subwhiteboard-link"
							)
								continue;
							migrating.set(id, payload);
						}
						for (const [id, payload] of incomingUpserts)
							migrating.set(id, payload);
						for (const id of incomingRemovals) migrating.delete(id);
						for (const [id, payload] of migrating) {
							const rowId = `${whiteboardId}:${id}`;
							const shape = payload as {
								typeName?: unknown;
								type?: unknown;
							};
							writes.push({
								entity: "canvasRecord",
								operation: "upsert",
								id: rowId,
								value: {
									id: rowId,
									whiteboardId,
									recordId: id,
									recordType: String(shape.typeName ?? shape.type ?? "unknown"),
									payload,
									createdAt: timestamp,
									updatedAt: timestamp,
									updatedByDeviceId: deviceId,
									deletedAt: null,
									clock,
								},
								expectedRevision: 0,
							});
							if (incomingUpserts.has(id)) versions[id] = 1;
						}
						await applyWrites(repository, "records.update", writes);
						return { versions };
					}
				}

				for (const [id, payload] of incomingUpserts) {
					const prior = existing.get(id);
					const rowId = prior?.id ?? `${whiteboardId}:${id}`;
					const shape = payload as { typeName?: unknown; type?: unknown };
					writes.push({
						entity: "canvasRecord",
						operation: "upsert",
						id: rowId,
						value: {
							...(prior ?? { createdAt: timestamp }),
							id: rowId,
							whiteboardId,
							recordId: id,
							recordType: String(shape.typeName ?? shape.type ?? "unknown"),
							payload,
							updatedAt: timestamp,
							updatedByDeviceId: deviceId,
							deletedAt: null,
							clock,
						},
						...(prior ? { expectedRevision: prior.revision } : {}),
					});
					versions[id] = (prior?.revision ?? 0) + 1;
				}

				for (const id of incomingRemovals) {
					const prior = existing.get(id);
					if (!prior) continue;
					writes.push({
						entity: "canvasRecord",
						operation: "delete",
						id: prior.id,
						expectedRevision: prior.revision,
					});
					// No echo expectation for removals: this backend's `list` hides
					// tombstones, so a deleted record can never report its new
					// revision back and the canvas would wait forever.
				}

				await applyWrites(repository, "records.update", writes);
				return { versions };
			});
		},

		subscribeItems(whiteboardId, listener, options) {
			return repository.subscribe(
				(change) => {
					if (
						options?.cardIds &&
						change.changes.every(
							(item) =>
								item.entityType === "card" &&
								!options.cardIds?.includes(item.entityId),
						)
					)
						return;
					listener();
				},
				{
					entityTypes: ["boardItem", "card", "cardContent", "whiteboard"],
					whiteboardIds: [whiteboardId],
				},
			);
		},

		subscribeDocument(whiteboardId, listener) {
			return repository.subscribe(() => listener(), {
				entityTypes: ["canvasRecord", "tldrawDocument"],
				whiteboardIds: [whiteboardId],
			});
		},
	};
}
