import type { WorkspaceRepository } from "@contextboard/client-core";
import { isActiveRow, listRows } from "../repository/entities";
import type { SearchService } from "../runtime";

export function createRepositorySearchService(
	repository: WorkspaceRepository,
): SearchService {
	return {
		async search({ term, whiteboardId, limit = 8 }) {
			const [cards, whiteboards, items] = await Promise.all([
				listRows(repository, "cards"),
				listRows(repository, "whiteboards"),
				listRows(repository, "items"),
			]);
			const normalized = term.trim().toLocaleLowerCase();
			const activeItems = items.filter(isActiveRow);
			const localCardIds = whiteboardId
				? new Set(
						activeItems
							.filter((item) => item.whiteboardId === whiteboardId)
							.map((item) => item.cardId),
					)
				: null;
			const activeCards = cards
				.filter(
					(card) =>
						isActiveRow(card) &&
						(!localCardIds || localCardIds.has(card.id)) &&
						(!normalized ||
							`${String(card.derivedTitle ?? "")} ${String(card.plainText ?? "")}`
								.toLocaleLowerCase()
								.includes(normalized)),
				)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, limit);
			const activeWhiteboards = whiteboards
				.filter(
					(board) =>
						isActiveRow(board) &&
						(!whiteboardId || board.parentWhiteboardId === whiteboardId) &&
						(!normalized ||
							String(board.title ?? "")
								.toLocaleLowerCase()
								.includes(normalized)),
				)
				.slice(0, limit);

			return {
				cards: activeCards.map((card) => {
					const placements = activeItems
						.filter((item) => item.cardId === card.id)
						.sort((a, b) => b.updatedAt - a.updatedAt);
					const placement =
						placements.find((item) => item.whiteboardId === whiteboardId) ??
						placements[0] ??
						null;
					return {
						kind: "card" as const,
						id: card.id,
						title: String(card.derivedTitle ?? ""),
						preview: String(card.preview ?? ""),
						content: card.content ?? null,
						boardWhiteboardId:
							typeof placement?.whiteboardId === "string"
								? placement.whiteboardId
								: null,
						shapeId: placement ? String(placement.shapeId ?? "") : null,
					};
				}),
				whiteboards: activeWhiteboards.map((board) => {
					const placement = activeItems.find(
						(item) => item.childWhiteboardId === board.id,
					);
					return {
						kind: "whiteboard" as const,
						id: board.id,
						title: String(board.title ?? ""),
						boardWhiteboardId:
							typeof placement?.whiteboardId === "string"
								? placement.whiteboardId
								: typeof board.parentWhiteboardId === "string"
									? board.parentWhiteboardId
									: null,
						shapeId: placement ? String(placement.shapeId ?? "") : null,
					};
				}),
			};
		},
	};
}
