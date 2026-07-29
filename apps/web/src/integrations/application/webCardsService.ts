import type {
	AppendCardPlacement,
	CardDetail,
	CardSearchResult,
	CardSortOrder,
	CardSummary,
	CardsService,
	ListCardsOptions,
} from "@contextboard/application";
import type { ContextboardDatabase } from "@contextboard/local-db";
import { localMutation, localQuery } from "../local/operations";
import {
	notifyLocalDatabaseChange,
	subscribeToLocalDatabaseChanges,
} from "../local/subscriptions";

type WebCard = {
	id?: string;
	_id?: string;
	content?: unknown;
	derivedTitle?: string;
	preview?: string;
	createdAt?: number;
	updatedAt?: number;
	contentVersion?: number;
	version?: number;
	activePlacementCount?: number;
};

type WebPlacement = {
	_id?: string;
	id?: string;
	whiteboardId?: string | null;
	shapeId?: string;
	updatedAt?: number;
};

type EnrichedWebCard = {
	card?: WebCard;
	placements?: CardDetail["placements"];
	backlinks?: CardDetail["backlinks"];
	preferredPlacement?: WebPlacement | null;
	breadcrumbs?: Array<{ _id?: string; id?: string; title?: string }>;
	boardWhiteboardId?: string | null;
	shapeId?: string | null;
};

const SORT_MAP: Record<CardSortOrder, string> = {
	updated_desc: "updated",
	updated_asc: "updated_asc",
	title: "title",
	title_desc: "title_desc",
};

function summary(row: WebCard): CardSummary {
	return {
		id: String(row.id ?? row._id),
		title: row.derivedTitle || "Untitled card",
		preview: row.preview ?? "",
		createdAt: row.createdAt ?? 0,
		updatedAt: row.updatedAt ?? 0,
		version: row.contentVersion ?? row.version ?? 1,
		activePlacementCount: row.activePlacementCount ?? 0,
	};
}

export function createWebCardsService(
	database: ContextboardDatabase,
	deviceId: string,
): CardsService {
	async function mutate<T>(
		reference: string,
		args: Record<string, unknown>,
	): Promise<T> {
		const result = await localMutation(database, deviceId, reference, args);
		notifyLocalDatabaseChange(database);
		return result as T;
	}

	return {
		async list(options: ListCardsOptions = {}) {
			const rows = (await localQuery(database, "cards.listAll", {
				...(options.searchTerm ? { searchTerm: options.searchTerm } : {}),
				sortBy: SORT_MAP[options.sortBy ?? "updated_desc"],
			})) as WebCard[];
			return rows.map(summary);
		},
		async get(cardId) {
			const enriched = (await localQuery(database, "cards.get", {
				cardId,
			})) as (EnrichedWebCard & WebCard) | null;
			if (!enriched) return null;
			const row = enriched.card ?? enriched;
			const preferred = enriched.preferredPlacement ?? null;
			return {
				...summary(row),
				content: row.content ?? null,
				activePlacementCount: row.activePlacementCount ?? 0,
				placements: enriched.placements ?? [],
				backlinks: enriched.backlinks ?? [],
				preferredPlacement: preferred
					? {
							itemId: String(preferred._id ?? preferred.id),
							whiteboardId: preferred.whiteboardId ?? null,
							shapeId: preferred.shapeId ?? "",
							updatedAt: preferred.updatedAt ?? 0,
						}
					: null,
				boardWhiteboardId: enriched.boardWhiteboardId ?? null,
				shapeId: enriched.shapeId ?? null,
				breadcrumbs: (enriched.breadcrumbs ?? []).map((entry) => ({
					id: String(entry._id ?? entry.id),
					title: entry.title ?? "",
				})),
			} satisfies CardDetail;
		},
		create(input = {}) {
			return mutate<string>("cards.create", input);
		},
		updateContent(input) {
			return mutate<number>("cards.updateContent", input);
		},
		delete(cardId) {
			return mutate<void>("cards.archiveCard", { cardId });
		},
		deleteMany(cardIds) {
			return mutate<void>("cards.archiveCards", { cardIds });
		},
		async appendToWhiteboard(input) {
			return (
				(await mutate<AppendCardPlacement | null>(
					"cards.appendToWhiteboard",
					input,
				)) ?? null
			);
		},
		async appendManyToWhiteboard(input) {
			const result = await mutate<{ placements?: AppendCardPlacement[] }>(
				"cards.appendCardsToWhiteboard",
				input,
			);
			return result?.placements ?? [];
		},
		async search({ query, limit, excludeCardId }) {
			const results = (await localQuery(
				database,
				"search.searchCardsForReference",
				{ term: query },
			)) as CardSearchResult[];
			const filtered = results.filter((row) => row.id !== excludeCardId);
			return limit === undefined ? filtered : filtered.slice(0, limit);
		},
		subscribe(listener) {
			return subscribeToLocalDatabaseChanges(database, listener);
		},
	};
}
