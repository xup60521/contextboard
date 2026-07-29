import type { EntityWrite } from "../../workspace";
import { type Plan, upsertWrite } from "../planner";

type Placement = Record<string, unknown> & {
	id: string;
	revision: number;
	archivedAt: number | null;
};

type Card = Record<string, unknown> & {
	id: string;
	revision: number;
	activePlacementCount: number;
	archivedAt: number | null;
};

export type ArchiveCardSnapshot = {
	card: Card;
	placements: Placement[];
};

export function planArchiveCard(
	snapshot: ArchiveCardSnapshot,
	context: { now: number },
): Plan<null> {
	const writes: EntityWrite[] = snapshot.placements.map((placement) =>
		upsertWrite(
			"boardItem",
			{ ...placement, archivedAt: context.now },
			placement.revision,
		),
	);
	writes.push(
		upsertWrite(
			"card",
			{
				...snapshot.card,
				activePlacementCount: 0,
				archivedAt: context.now,
			},
			snapshot.card.revision,
		),
	);
	return { writes, result: null };
}

export function planArchiveCards(
	snapshots: ArchiveCardSnapshot[],
	context: { now: number },
): Plan<null> {
	return {
		writes: snapshots.flatMap(
			(snapshot) => planArchiveCard(snapshot, context).writes,
		),
		result: null,
	};
}
