import type { WorkspaceRepository } from "@contextboard/client-core";
import { collectReferenceIds } from "../canvas/derive/references";
import { planAppendCard } from "../canvas/plan/append-card";
import {
	type ArchiveCardSnapshot,
	planArchiveCards,
} from "../canvas/plan/archive-card";
import { type Frame, findFreeFrame } from "../canvas/plan/place-card-frame";
import { planReferences } from "../canvas/plan/references";
import { normalizeImageSources } from "../files/fileUrl";
import {
	applyWrites,
	type EntityRow,
	isActiveRow,
	listRows,
} from "../repository/entities";
import type {
	AppendCardFrame,
	AppendCardPlacement,
	CardDetail,
	CardPlacement,
	CardSearchResult,
	CardSortOrder,
	CardSummary,
	CardsService,
	ListCardsOptions,
	UpdateCardContentInput,
} from "../runtime";
import { withRetry } from "../workspace";
import {
	DEFAULT_CARD_CONTENT,
	DEFAULT_CARD_TITLE,
	deriveCardMetadata,
	normalizeCardContent,
} from "./card-content";
import { estimateCardHeight } from "./estimate-card-height";

/**
 * The card entity as it is materialized by every backend's generic entity
 * store. Backends own persistence, revisions and the pending batch; the shape
 * and every derived field are owned here so both platforms agree.
 */
export type CardEntity = {
	id: string;
	content: unknown;
	derivedTitle: string;
	plainText: string;
	preview: string;
	contentVersion: number;
	createdAt: number;
	updatedAt: number;
	revision: number;
	activePlacementCount: number;
	updatedByDeviceId: string;
	deletedAt: number | null;
	archivedAt: number | null;
};

/** Matches the Web whiteboard card width so both platforms lay out equally. */
const DEFAULT_CARD_WIDTH = 576;
const DEFAULT_CARD_HEIGHT = 180;
const DEFAULT_SEARCH_LIMIT = 8;

const isActive = (card: CardEntity) =>
	card.deletedAt === null && card.archivedAt === null;

function toSummary(card: CardEntity): CardSummary {
	return {
		id: card.id,
		title: card.derivedTitle || DEFAULT_CARD_TITLE,
		preview: card.preview,
		createdAt: card.createdAt,
		updatedAt: card.updatedAt,
		version: card.contentVersion,
		activePlacementCount: card.activePlacementCount,
	};
}

function comparator(sortBy: CardSortOrder) {
	switch (sortBy) {
		case "title":
			return (a: CardEntity, b: CardEntity) =>
				a.derivedTitle.localeCompare(b.derivedTitle);
		case "title_desc":
			return (a: CardEntity, b: CardEntity) =>
				b.derivedTitle.localeCompare(a.derivedTitle);
		case "updated_asc":
			return (a: CardEntity, b: CardEntity) => a.updatedAt - b.updatedAt;
		default:
			return (a: CardEntity, b: CardEntity) => b.updatedAt - a.updatedAt;
	}
}

function normalize(value: unknown): CardEntity | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Partial<CardEntity>;
	if (typeof row.id !== "string") return null;
	return {
		id: row.id,
		// Rows written before restore/adopt learned to parse the canvas's
		// serialized props hold the document as a string. Repair on read so an
		// affected card still renders; the next edit rewrites it properly.
		content:
			typeof row.content === "string"
				? normalizeCardContent(row.content)
				: (row.content ?? null),
		derivedTitle: row.derivedTitle ?? DEFAULT_CARD_TITLE,
		plainText: row.plainText ?? "",
		preview: row.preview ?? "",
		contentVersion:
			typeof row.contentVersion === "number" ? row.contentVersion : 1,
		createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
		updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
		revision: typeof row.revision === "number" ? row.revision : 1,
		activePlacementCount:
			typeof row.activePlacementCount === "number"
				? row.activePlacementCount
				: 0,
		updatedByDeviceId:
			typeof row.updatedByDeviceId === "string" ? row.updatedByDeviceId : "",
		deletedAt: row.deletedAt ?? null,
		archivedAt: row.archivedAt ?? null,
	};
}

function toPlacement(item: EntityRow): CardPlacement {
	return {
		itemId: item.id,
		whiteboardId:
			typeof item.whiteboardId === "string" ? item.whiteboardId : null,
		shapeId: String(item.shapeId ?? ""),
		updatedAt: item.updatedAt,
	};
}

/**
 * Picks the placement the card detail UI should navigate to: the one on the
 * preferred whiteboard when given, otherwise the most recently touched one.
 */
function preferPlacement(placements: EntityRow[], preferred?: string | null) {
	return (
		placements.find((row) => preferred && row.whiteboardId === preferred) ??
		[...placements].sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
		null
	);
}

/**
 * Release A databases can contain a placeholder cardContent row created from a
 * lightweight card that did not carry its legacy body. A null document is not
 * authoritative: prefer the legacy card body until a real external document
 * has been materialized. This keeps mixed-version imports and partially
 * migrated local databases readable on every card surface.
 */
function hasMaterializedCardContent(
	row: Record<string, unknown> | null | undefined,
): row is Record<string, unknown> {
	return row != null && row.document !== null && row.document !== undefined;
}

/**
 * Card capability implemented purely through the semantic
 * {@link WorkspaceRepository} boundary. The renderer never learns about SQL,
 * IndexedDB object stores or filesystem layout — only allow-listed domain
 * operations over the generic entity store.
 */
export function createRepositoryCardsService(
	repository: WorkspaceRepository,
	options: {
		now?: () => number;
		createId?: () => string;
		deviceId?: string;
	} = {},
): CardsService {
	const now = options.now ?? (() => Date.now());
	const createId = options.createId ?? (() => crypto.randomUUID());
	const deviceId = options.deviceId ?? "";

	async function read(cardId: string): Promise<CardEntity | null> {
		const [rawCard, rawContent] = await Promise.all([
			repository.query({ type: "cards.get", input: { id: cardId } }),
			repository.query<unknown>({
				type: "cardContents.get",
				input: { id: cardId },
			}),
		]);
		const contentRow =
			rawContent && typeof rawContent === "object"
				? (rawContent as Record<string, unknown>)
				: null;
		const row = normalize(
			rawCard &&
				typeof rawCard === "object" &&
				hasMaterializedCardContent(contentRow)
				? {
						...(rawCard as Record<string, unknown>),
						content: contentRow.document,
						contentVersion: contentRow.contentVersion,
					}
				: rawCard,
		);
		return row && isActive(row) ? row : null;
	}

	async function listCards(): Promise<CardEntity[]> {
		const raw = await repository.query<unknown>({
			type: "cards.list",
			input: {},
		});
		return (Array.isArray(raw) ? raw : [])
			.map(normalize)
			.filter((row): row is CardEntity => row !== null && isActive(row));
	}

	/**
	 * The rows every {@link CardDetail} in one batch is assembled from. Read once
	 * per call rather than once per card: on the desktop backend each read is a
	 * Tauri IPC round trip, so a per-card fan-out multiplies both the round trips
	 * and the JSON re-serialization of every row it returns.
	 */
	type CardDetailContext = {
		rowById: Map<string, CardEntity>;
		activeItemsByCardId: Map<string, EntityRow[]>;
		boardById: Map<string, EntityRow>;
		backlinksByTargetId: Map<string, EntityRow[]>;
		backlinkSourceById: Map<string, CardEntity>;
	};

	async function readDetailContext(
		cardIds: readonly string[],
	): Promise<CardDetailContext> {
		const wanted = new Set(cardIds);
		const [rows, contentRows, items, references] = await Promise.all([
			listRows(repository, "cards", { ids: [...wanted] }),
			listRows(repository, "cardContents", { cardIds: [...wanted] }),
			listRows(repository, "items", { cardIds: [...wanted] }),
			listRows(repository, "cardReferences", {
				targetCardIds: [...wanted],
			}),
		]);

		// Backlinks only need the *source* cards' title and preview, so resolve
		// them by id instead of pulling the whole card table — every row of which
		// carries its full content.
		const backlinksByTargetId = new Map<string, EntityRow[]>();
		const sourceIds = new Set<string>();
		for (const reference of references) {
			const targetCardId = String(reference.targetCardId ?? "");
			if (!wanted.has(targetCardId)) continue;
			const bucket = backlinksByTargetId.get(targetCardId);
			if (bucket) bucket.push(reference);
			else backlinksByTargetId.set(targetCardId, [reference]);
			const sourceCardId = String(reference.sourceCardId ?? "");
			if (sourceCardId) sourceIds.add(sourceCardId);
		}
		const sources =
			sourceIds.size > 0
				? await listRows(repository, "cards", { ids: [...sourceIds] })
				: [];
		const activeItems = items.filter(isActiveRow);
		const placedBoardIds = [
			...new Set(
				activeItems.flatMap((item) =>
					typeof item.whiteboardId === "string" ? [item.whiteboardId] : [],
				),
			),
		];
		const placedBoards = placedBoardIds.length
			? await listRows(repository, "whiteboards", { ids: placedBoardIds })
			: [];
		const ancestorIds = [
			...new Set(
				placedBoards.flatMap((board) =>
					Array.isArray(board.ancestorIds) ? board.ancestorIds.map(String) : [],
				),
			),
		].filter((id) => !placedBoardIds.includes(id));
		const ancestorBoards = ancestorIds.length
			? await listRows(repository, "whiteboards", { ids: ancestorIds })
			: [];
		const activeItemsByCardId = new Map<string, EntityRow[]>();
		for (const item of activeItems) {
			if (typeof item.cardId !== "string") continue;
			const bucket = activeItemsByCardId.get(item.cardId);
			if (bucket) bucket.push(item);
			else activeItemsByCardId.set(item.cardId, [item]);
		}

		const toCardEntities = (values: EntityRow[]) =>
			values
				.map(normalize)
				.filter((row): row is CardEntity => row !== null && isActive(row));

		const contentByCardId = new Map(
			contentRows
				.filter(isActiveRow)
				.map((row) => [String(row.cardId), row] as const),
		);
		return {
			rowById: new Map(
				toCardEntities(rows).map((row) => {
					const content = contentByCardId.get(row.id);
					return [
						row.id,
						hasMaterializedCardContent(content)
							? (normalize({
									...row,
									content: content.document,
									contentVersion: content.contentVersion,
								}) ?? row)
							: row,
					] as const;
				}),
			),
			activeItemsByCardId,
			boardById: new Map(
				[...placedBoards, ...ancestorBoards]
					.filter(isActiveRow)
					.map((board) => [board.id, board]),
			),
			backlinksByTargetId,
			backlinkSourceById: new Map(
				toCardEntities(sources).map((row) => [row.id, row]),
			),
		};
	}

	async function getManyDetails(
		cardIds: readonly string[],
	): Promise<Array<CardDetail | null>> {
		if (cardIds.length === 0) return [];
		const context = await readDetailContext(cardIds);
		return cardIds.map((cardId) => {
			const row = context.rowById.get(cardId);
			return row ? buildCardDetail(row, context) : null;
		});
	}

	function buildCardDetail(
		row: CardEntity,
		context: CardDetailContext,
	): CardDetail {
		const placements = context.activeItemsByCardId.get(row.id) ?? [];
		const preferred = preferPlacement(placements);
		const board =
			preferred && typeof preferred.whiteboardId === "string"
				? (context.boardById.get(preferred.whiteboardId) ?? null)
				: null;
		const breadcrumbs = board
			? [
					...(Array.isArray(board.ancestorIds)
						? board.ancestorIds.map(String)
						: []),
					board.id,
				]
					.map((entry) => context.boardById.get(entry))
					.filter((entry): entry is EntityRow => !!entry)
					.map((entry) => ({
						id: entry.id,
						title: typeof entry.title === "string" ? entry.title : "",
					}))
			: [];

		return {
			...toSummary(row),
			content: row.content,
			activePlacementCount: row.activePlacementCount,
			placements: placements.map(toPlacement),
			preferredPlacement: preferred ? toPlacement(preferred) : null,
			boardWhiteboardId:
				preferred && typeof preferred.whiteboardId === "string"
					? preferred.whiteboardId
					: null,
			shapeId: preferred ? String(preferred.shapeId ?? "") : null,
			breadcrumbs,
			backlinks: (context.backlinksByTargetId.get(row.id) ?? [])
				.flatMap((reference) => {
					const source = context.backlinkSourceById.get(
						String(reference.sourceCardId),
					);
					return source
						? [
								{
									cardId: source.id,
									title: source.derivedTitle,
									preview: source.preview,
								},
							]
						: [];
				})
				.sort((a, b) => a.title.localeCompare(b.title)),
		};
	}

	/**
	 * Keeps `cardReference`/`fileReference` rows in step with the content, so
	 * backlinks and blob refcounts behave identically on both platforms.
	 */
	async function planReferenceWrites(cardId: string, content: unknown) {
		const targetKey = `card:${cardId}`;
		const [targetFileReferences, cardReferences] = await Promise.all([
			listRows(repository, "fileReferences", { targetKeys: [targetKey] }),
			listRows(repository, "cardReferences", { sourceCardIds: [cardId] }),
		]);
		const affectedFileIds = [
			...new Set([
				...targetFileReferences.map((row) => String(row.fileId ?? "")),
				...collectReferenceIds(content, "fileId"),
			]),
		].filter(Boolean);
		const [allFileReferences, files] = await Promise.all([
			affectedFileIds.length
				? listRows(repository, "fileReferences", { fileIds: affectedFileIds })
				: Promise.resolve([]),
			affectedFileIds.length
				? listRows(repository, "files", { ids: affectedFileIds })
				: Promise.resolve([]),
		]);
		const plan = planReferences(
			{
				targetFileReferences: targetFileReferences as never[],
				allFileReferences: allFileReferences as never[],
				cardReferences: cardReferences as never[],
				files: files as never[],
			},
			{ targetType: "card", targetId: cardId, content },
			{ now: now(), deviceId },
		);
		return plan.writes;
	}

	async function archive(cardIds: string[], commandType: string) {
		if (cardIds.length === 0) return;
		const [cards, items, relations] = await Promise.all([
			listCards(),
			listRows(repository, "items"),
			listRows(repository, "cardRelations"),
		]);
		const cardById = new Map(cards.map((card) => [card.id, card]));
		const snapshots: ArchiveCardSnapshot[] = [];
		for (const cardId of cardIds) {
			const card = cardById.get(cardId);
			if (!card) continue;
			snapshots.push({
				card: card as never,
				placements: items.filter(
					(item) => isActiveRow(item) && item.cardId === cardId,
				) as never[],
				relations: relations.filter(
					(relation) =>
						isActiveRow(relation) &&
						(relation.sourceCardId === cardId ||
							relation.targetCardId === cardId),
				) as never[],
			});
		}
		const plan = planArchiveCards(snapshots, { now: now() });
		await applyWrites(repository, commandType, plan.writes);
	}

	async function append(
		cardIds: string[],
		whiteboardId: string,
		frame: AppendCardFrame = {},
	) {
		const results: AppendCardPlacement[] = [];
		for (const cardId of cardIds) {
			// Re-read on every iteration so a batch append sees the placements it
			// just made and auto-placement does not collide with itself.
			const [card, items] = await Promise.all([
				read(cardId),
				listRows(repository, "items"),
			]);
			const existing = items.find(
				(item) =>
					isActiveRow(item) &&
					item.cardId === cardId &&
					item.whiteboardId === whiteboardId,
			);
			const timestamp = now();
			// A caller that names a height means it; otherwise derive one from the
			// content, because the flat default fits almost no card it is given to.
			const width = frame.w ?? DEFAULT_CARD_WIDTH;
			const size = {
				w: width,
				h:
					frame.h ??
					(card
						? estimateCardHeight(card.content, width)
						: DEFAULT_CARD_HEIGHT),
			};
			// Only a caller that gives neither coordinate wants auto-placement;
			// `x: 0, y: 0` is a literal request for the origin.
			const position =
				frame.x === undefined && frame.y === undefined
					? findFreeFrame(
							items.filter(
								(item) =>
									isActiveRow(item) && item.whiteboardId === whiteboardId,
							) as unknown as Frame[],
							size,
						)
					: { x: frame.x ?? 0, y: frame.y ?? 0 };
			const plan = planAppendCard(
				{
					card: existing ? null : (card as never),
					existingPlacement: (existing as never) ?? null,
				},
				{
					whiteboardId,
					itemId: createId(),
					shapeId: `shape:card-${cardId}-${timestamp}-${results.length}`,
					x: position.x,
					y: position.y,
					w: size.w,
					h: size.h,
					rotation: 0,
					zIndex: timestamp + results.length,
				},
				{ now: timestamp, deviceId },
			);
			await applyWrites(repository, "items.create", plan.writes);
			if (plan.result) results.push({ ...plan.result, cardId, whiteboardId });
		}
		return results;
	}

	return {
		async list(listOptions: ListCardsOptions = {}) {
			const rows = await listCards();
			const term = listOptions.searchTerm?.trim().toLocaleLowerCase() ?? "";
			let filtered = term
				? rows.filter((row) =>
						`${row.derivedTitle} ${row.plainText}`
							.toLocaleLowerCase()
							.includes(term),
					)
				: rows;
			if (listOptions.orphanOnly === true)
				filtered = filtered.filter((row) => row.activePlacementCount === 0);
			return filtered
				.sort(comparator(listOptions.sortBy ?? "updated_desc"))
				.map(toSummary);
		},

		async get(cardId: string): Promise<CardDetail | null> {
			return (await getManyDetails([cardId]))[0] ?? null;
		},

		async create(input = {}) {
			const content = normalizeImageSources(
				input.content ?? DEFAULT_CARD_CONTENT,
			);
			const cardId = createId();
			return withRetry(async () => {
				const timestamp = now();
				const value: CardEntity = {
					id: cardId,
					// The document is authoritative in cardContents. Keep the card row a
					// lightweight summary so list/search reads never deserialize every
					// TipTap tree in the workspace.
					content: null,
					...deriveCardMetadata(content),
					contentVersion: 1,
					createdAt: timestamp,
					updatedAt: timestamp,
					revision: 1,
					activePlacementCount: 0,
					updatedByDeviceId: deviceId,
					deletedAt: null,
					archivedAt: null,
				};
				const referenceWrites = await planReferenceWrites(cardId, content);
				await applyWrites(repository, "cards.create", [
					{
						entity: "card",
						operation: "upsert",
						id: cardId,
						value,
						expectedRevision: 0,
					},
					{
						entity: "cardContent",
						operation: "upsert",
						id: cardId,
						value: {
							id: cardId,
							cardId,
							document: content,
							contentVersion: 1,
							clock: "",
						},
						expectedRevision: 0,
					},
					...referenceWrites,
				]);
				return cardId;
			});
		},

		getMany(cardIds: string[]) {
			return getManyDetails(cardIds);
		},

		async updateContent({
			cardId,
			content,
			expectedVersion,
		}: UpdateCardContentInput) {
			const normalizedContent = normalizeImageSources(content);
			return withRetry(async () => {
				const row = await read(cardId);
				if (!row) throw new Error("Card not found");
				const contentRow = await repository.query<Record<
					string,
					unknown
				> | null>({
					type: "cardContents.get",
					input: { id: cardId },
				});
				if (
					typeof expectedVersion === "number" &&
					expectedVersion !== row.contentVersion
				)
					throw new Error("Card was updated elsewhere");
				if (
					contentRow &&
					JSON.stringify(normalizedContent) === JSON.stringify(row.content)
				)
					return row.contentVersion;
				const contentVersion = row.contentVersion + 1;
				const value: CardEntity = {
					...row,
					content: null,
					...deriveCardMetadata(normalizedContent),
					contentVersion,
					updatedAt: now(),
				};
				const referenceWrites = await planReferenceWrites(
					cardId,
					normalizedContent,
				);
				await applyWrites(repository, "cards.update", [
					{
						entity: "card",
						operation: "upsert",
						id: cardId,
						value,
						expectedRevision: row.revision,
					},
					{
						entity: "cardContent",
						operation: "upsert",
						id: cardId,
						value: {
							id: cardId,
							cardId,
							document: normalizedContent,
							contentVersion,
							clock: "",
						},
						expectedRevision:
							typeof contentRow?.revision === "number"
								? contentRow.revision
								: 0,
					},
					...referenceWrites,
				]);
				return contentVersion;
			});
		},

		async delete(cardId: string) {
			await archive([cardId], "cards.delete");
		},

		async deleteMany(cardIds: string[]) {
			await archive(cardIds, "cards.deleteMany");
		},

		async appendToWhiteboard({ cardId, whiteboardId, ...frame }) {
			return (await append([cardId], whiteboardId, frame))[0] ?? null;
		},

		async appendManyToWhiteboard({ cardIds, whiteboardId, ...frame }) {
			return append(cardIds, whiteboardId, frame);
		},

		async search({
			query,
			limit = DEFAULT_SEARCH_LIMIT,
			excludeCardId,
			whiteboardId,
		}) {
			const term = query.trim().toLocaleLowerCase();
			const [cards, items] = await Promise.all([
				listCards(),
				listRows(repository, "items"),
			]);
			const activeItems = items.filter(isActiveRow);
			// An empty query is "show me this board's recent cards"; typing makes
			// the search global.
			const boardCardIds =
				!term && whiteboardId
					? new Set(
							activeItems
								.filter((item) => item.whiteboardId === whiteboardId)
								.map((item) => item.cardId),
						)
					: null;
			return cards
				.filter(
					(card) =>
						card.id !== excludeCardId &&
						(!boardCardIds || boardCardIds.has(card.id)) &&
						(!term ||
							`${card.derivedTitle} ${card.plainText}`
								.toLocaleLowerCase()
								.includes(term)),
				)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, limit)
				.map<CardSearchResult>((card) => {
					const placement = preferPlacement(
						activeItems.filter((item) => item.cardId === card.id),
						whiteboardId,
					);
					return {
						id: card.id,
						title: card.derivedTitle || DEFAULT_CARD_TITLE,
						preview: card.preview,
						boardWhiteboardId:
							placement && typeof placement.whiteboardId === "string"
								? placement.whiteboardId
								: null,
						shapeId: placement ? String(placement.shapeId ?? "") : null,
					};
				});
		},

		subscribe(listener, options) {
			return repository.subscribe(
				(change) => {
					if (
						options?.cardIds &&
						!change.changes.some(
							(item) =>
								item.entityType !== "card" ||
								options.cardIds?.includes(item.entityId) ||
								(item.cardId !== null &&
									item.cardId !== undefined &&
									options.cardIds?.includes(item.cardId)),
						)
					)
						return;
					listener();
				},
				{
					entityTypes: [
						"card",
						"cardContent",
						"boardItem",
						"cardReference",
						"fileReference",
						"whiteboard",
					],
				},
			);
		},
	};
}
