import type { WorkspaceRepository } from "@contextboard/client-core";
import { isActiveRow, listRows } from "../repository/entities";
import type { SearchService } from "../runtime";

export function createRepositorySearchService(
	repository: WorkspaceRepository,
): SearchService {
	return {
		async search({ term, whiteboardId, limit = 8 }) {
			const normalized = term.trim().toLocaleLowerCase();
			const localItems = whiteboardId
				? (await listRows(repository, "items", { whiteboardId })).filter(
						isActiveRow,
					)
				: null;
			const localCardIds = localItems
				? new Set(localItems.map((item) => item.cardId))
				: null;
			const localWhiteboardIds = localItems
				? new Set(localItems.map((item) => item.childWhiteboardId))
				: null;
			const [cards, whiteboards] = await Promise.all([
				localCardIds
					? listRows(repository, "cards", {
							ids: [...localCardIds].filter(
								(id): id is string => typeof id === "string",
							),
						})
					: listRows(repository, "cards"),
				whiteboardId
					? listRows(repository, "whiteboards", {
							parentWhiteboardIds: [whiteboardId],
						})
					: listRows(repository, "whiteboards"),
			]);
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
						(!localWhiteboardIds || localWhiteboardIds.has(board.id)) &&
						(!normalized ||
							String(board.title ?? "")
								.toLocaleLowerCase()
								.includes(normalized)),
				)
				.slice(0, limit);
			const cardIds = activeCards.map((card) => card.id);
			const whiteboardIds = activeWhiteboards.map((board) => board.id);
			const [cardContents, cardItems, whiteboardItems] = await Promise.all([
				cardIds.length
					? listRows(repository, "cardContents", { cardIds })
					: Promise.resolve([]),
				localItems !== null
					? Promise.resolve(localItems)
					: cardIds.length
						? listRows(repository, "items", { cardIds })
						: Promise.resolve([]),
				localItems !== null
					? Promise.resolve(localItems)
					: whiteboardIds.length
						? listRows(repository, "items", {
								childWhiteboardIds: whiteboardIds,
							})
						: Promise.resolve([]),
			]);
			const contentByCardId = new Map(
				cardContents
					.filter(isActiveRow)
					.map((row) => [String(row.cardId), row.document] as const),
			);

			return {
				cards: activeCards.map((card) => {
					const placements = cardItems
						.filter(isActiveRow)
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
						content: contentByCardId.get(card.id) ?? card.content ?? null,
						boardWhiteboardId:
							typeof placement?.whiteboardId === "string"
								? placement.whiteboardId
								: null,
						shapeId: placement ? String(placement.shapeId ?? "") : null,
					};
				}),
				whiteboards: activeWhiteboards.map((board) => {
					const placement = whiteboardItems.find(
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
