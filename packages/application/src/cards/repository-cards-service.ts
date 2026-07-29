import type { WorkspaceRepository } from "@contextboard/client-core";
import type {
	CardDetail,
	CardSortOrder,
	CardSummary,
	CardsService,
	ListCardsOptions,
} from "../runtime";
import {
	DEFAULT_CARD_CONTENT,
	DEFAULT_CARD_TITLE,
	deriveCardMetadata,
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
		content: row.content ?? null,
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

/**
 * Card capability implemented purely through the semantic
 * {@link WorkspaceRepository} boundary. The renderer never learns about SQL,
 * IndexedDB object stores or filesystem layout — only allow-listed domain
 * operations (`cards.list`, `cards.get`, `cards.create`, `cards.update`,
 * `cards.delete`).
 */
export function createRepositoryCardsService(
	repository: WorkspaceRepository,
	options: { now?: () => number; createId?: () => string } = {},
): CardsService {
	const now = options.now ?? (() => Date.now());
	const createId = options.createId ?? (() => crypto.randomUUID());

	async function read(cardId: string): Promise<CardEntity | null> {
		const row = normalize(
			await repository.query({ type: "cards.get", input: { id: cardId } }),
		);
		return row && isActive(row) ? row : null;
	}

	return {
		async list(listOptions: ListCardsOptions = {}) {
			const raw = await repository.query<unknown>({
				type: "cards.list",
				input: {},
			});
			const rows = (Array.isArray(raw) ? raw : [])
				.map(normalize)
				.filter((row): row is CardEntity => row !== null && isActive(row));
			const term = listOptions.searchTerm?.trim().toLocaleLowerCase() ?? "";
			const filtered = term
				? rows.filter((row) =>
						`${row.derivedTitle} ${row.plainText}`
							.toLocaleLowerCase()
							.includes(term),
					)
				: rows;
			return filtered
				.sort(comparator(listOptions.sortBy ?? "updated_desc"))
				.map(toSummary);
		},

		async get(cardId: string): Promise<CardDetail | null> {
			const row = await read(cardId);
			if (!row) return null;
			const [rawItems, rawReferences, rawCards] = await Promise.all([
				repository.query<unknown>({ type: "items.list", input: {} }),
				repository.query<unknown>({ type: "cardReferences.list", input: {} }),
				repository.query<unknown>({ type: "cards.list", input: {} }),
			]);
			const items = Array.isArray(rawItems) ? rawItems : [];
			const references = Array.isArray(rawReferences) ? rawReferences : [];
			const cards = (Array.isArray(rawCards) ? rawCards : [])
				.map(normalize)
				.filter((card): card is CardEntity => card !== null && isActive(card));
			const cardById = new Map(cards.map((card) => [card.id, card]));
			return {
				...toSummary(row),
				content: row.content,
				activePlacementCount: row.activePlacementCount,
				placements: items
					.filter(
						(item): item is Record<string, unknown> =>
							!!item &&
							typeof item === "object" &&
							(item as Record<string, unknown>).cardId === cardId &&
							(item as Record<string, unknown>).deletedAt === null &&
							(item as Record<string, unknown>).archivedAt === null,
					)
					.map((item) => ({
						itemId: String(item.id),
						whiteboardId:
							typeof item.whiteboardId === "string"
								? item.whiteboardId
								: null,
						shapeId: String(item.shapeId ?? ""),
						updatedAt:
							typeof item.updatedAt === "number" ? item.updatedAt : 0,
					})),
				backlinks: references
					.filter(
						(reference): reference is Record<string, unknown> =>
							!!reference &&
							typeof reference === "object" &&
							(reference as Record<string, unknown>).targetCardId === cardId,
					)
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
			const content = input.content ?? DEFAULT_CARD_CONTENT;
			const timestamp = now();
			const value: CardEntity = {
				id: createId(),
				content,
				...deriveCardMetadata(content),
				contentVersion: 1,
				createdAt: timestamp,
				updatedAt: timestamp,
				revision: 1,
				activePlacementCount: 0,
				updatedByDeviceId: "",
				deletedAt: null,
				archivedAt: null,
			};
			await repository.execute({ type: "cards.create", input: { value } });
			return value.id;
		},

		async updateContent({ cardId, content, expectedVersion }) {
			const row = await read(cardId);
			if (!row) throw new Error("Card not found");
			if (
				typeof expectedVersion === "number" &&
				expectedVersion !== row.contentVersion
			)
				throw new Error("Card was updated elsewhere");
			if (JSON.stringify(content) === JSON.stringify(row.content))
				return row.contentVersion;
			const contentVersion = row.contentVersion + 1;
			const value: CardEntity = {
				...row,
				content,
				...deriveCardMetadata(content),
				contentVersion,
				updatedAt: now(),
			};
			await repository.execute({ type: "cards.update", input: { value } });
			return contentVersion;
		},

		async delete(cardId: string) {
			const row = await read(cardId);
			if (!row) return;
			await repository.execute({
				type: "cards.delete",
				input: { value: { ...row, archivedAt: now() } },
			});
		},

		subscribe(listener: () => void) {
			return repository.subscribe(listener);
		},
	};
}
