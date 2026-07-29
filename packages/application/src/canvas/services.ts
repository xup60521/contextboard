import type { WorkspaceRepository } from "@contextboard/client-core";
import { deriveWhiteboardCounts } from "./derive/counts";

type Entity = Record<string, unknown> & {
	id: string;
	deletedAt: number | null;
	archivedAt?: number | null;
};

const active = (row: Entity) =>
	row.deletedAt === null &&
	(row.archivedAt === undefined || row.archivedAt === null);

export function createRepositoryWhiteboardsService(
	repository: WorkspaceRepository,
) {
	return {
		async list() {
			const [whiteboards, items] = await Promise.all([
				repository.query<Entity[]>({ type: "whiteboards.list", input: {} }),
				repository.query<Entity[]>({ type: "items.list", input: {} }),
			]);
			return whiteboards.filter(active).map((whiteboard) => ({
				...whiteboard,
				...deriveWhiteboardCounts(
					whiteboard.id,
					items as never[],
					whiteboards as never[],
				),
			}));
		},
	};
}

export function createRepositoryCanvasService(repository: WorkspaceRepository) {
	return {
		async listItems(whiteboardId: string) {
			const [items, cards, whiteboards] = await Promise.all([
				repository.query<Entity[]>({ type: "items.list", input: {} }),
				repository.query<Entity[]>({ type: "cards.list", input: {} }),
				repository.query<Entity[]>({ type: "whiteboards.list", input: {} }),
			]);
			const cardById = new Map(cards.filter(active).map((card) => [card.id, card]));
			const boardById = new Map(
				whiteboards.filter(active).map((board) => [
					board.id,
					{
						...board,
						...deriveWhiteboardCounts(
							board.id,
							items as never[],
							whiteboards as never[],
						),
					},
				]),
			);
			return items
				.filter(
					(item) => active(item) && item.whiteboardId === whiteboardId,
				)
				.map((item) => ({
					...item,
					card:
						typeof item.cardId === "string"
							? (cardById.get(item.cardId) ?? null)
							: null,
					childWhiteboard:
						typeof item.childWhiteboardId === "string"
							? (boardById.get(item.childWhiteboardId) ?? null)
							: null,
				}));
		},
	};
}
