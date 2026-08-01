import type { WorkspaceRepository } from "@contextboard/client-core";
import { planAppendCard } from "../canvas/plan/append-card";
import {
	type ArchiveCardSnapshot,
	planArchiveCards,
} from "../canvas/plan/archive-card";
import { planReferences } from "../canvas/plan/references";
import { normalizeImageSources } from "../files/fileUrl";
import {
	applyWrites,
	type EntityRow,
	isActiveRow,
	listRows,
} from "../repository/entities";
import type {
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
		const row = normalize(
			await repository.query({ type: "cards.get", input: { id: cardId } }),
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
	 * Keeps `cardReference`/`fileReference` rows in step with the content, so
	 * backlinks and blob refcounts behave identically on both platforms.
	 */
	async function planReferenceWrites(cardId: string, content: unknown) {
		const [fileReferences, cardReferences, files] = await Promise.all([
			listRows(repository, "fileReferences"),
			listRows(repository, "cardReferences"),
			listRows(repository, "files"),
		]);
		const targetKey = `card:${cardId}`;
		const plan = planReferences(
			{
				targetFileReferences: fileReferences.filter(
					(row) => row.targetKey === targetKey,
				) as never[],
				allFileReferences: fileReferences as never[],
				cardReferences: cardReferences.filter(
					(row) => row.sourceCardId === cardId,
				) as never[],
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

	async function append(cardIds: string[], whiteboardId: string) {
		const results: AppendCardPlacement[] = [];
		for (const cardId of cardIds) {
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
			const plan = planAppendCard(
				{
					card: existing ? null : (card as never),
					existingPlacement: (existing as never) ?? null,
				},
				{
					whiteboardId,
					itemId: createId(),
					shapeId: `shape:card-${cardId}-${timestamp}-${results.length}`,
					x: 0,
					y: 0,
					w: DEFAULT_CARD_WIDTH,
					h: DEFAULT_CARD_HEIGHT,
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
			const row = await read(cardId);
			if (!row) return null;
			const [items, references, cards, boards] = await Promise.all([
				listRows(repository, "items"),
				listRows(repository, "cardReferences"),
				listCards(),
				listRows(repository, "whiteboards"),
			]);
			const activeItems = items.filter(isActiveRow);
			const activeBoards = boards.filter(isActiveRow);
			const cardById = new Map(cards.map((card) => [card.id, card]));
			const boardById = new Map(activeBoards.map((board) => [board.id, board]));
			const placements = activeItems.filter((item) => item.cardId === cardId);
			const preferred = preferPlacement(placements);
			const board =
				preferred && typeof preferred.whiteboardId === "string"
					? (boardById.get(preferred.whiteboardId) ?? null)
					: null;
			const breadcrumbs = board
				? [
						...(Array.isArray(board.ancestorIds)
							? board.ancestorIds.map(String)
							: []),
						board.id,
					]
						.map((entry) => boardById.get(entry))
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
				backlinks: references
					.filter((reference) => reference.targetCardId === cardId)
					.flatMap((reference) => {
						const source = cardById.get(String(reference.sourceCardId));
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
					content,
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
					...referenceWrites,
				]);
				return cardId;
			});
		},

		async getMany(cardIds: string[]) {
			return Promise.all(cardIds.map((cardId) => this.get(cardId)));
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
				if (
					typeof expectedVersion === "number" &&
					expectedVersion !== row.contentVersion
				)
					throw new Error("Card was updated elsewhere");
				if (JSON.stringify(normalizedContent) === JSON.stringify(row.content))
					return row.contentVersion;
				const contentVersion = row.contentVersion + 1;
				const value: CardEntity = {
					...row,
					content: normalizedContent,
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

		async appendToWhiteboard({ cardId, whiteboardId }) {
			return (await append([cardId], whiteboardId))[0] ?? null;
		},

		async appendManyToWhiteboard({ cardIds, whiteboardId }) {
			return append(cardIds, whiteboardId);
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

		subscribe(listener: () => void) {
			return repository.subscribe(listener);
		},
	};
}
