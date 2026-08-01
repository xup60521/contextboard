import type { EntityWrite } from "../../workspace";
import { type Plan, tombstoneWrite, upsertWrite } from "../planner";

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
	relations?: Array<{ id: string; revision: number }>;
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
		...(snapshot.relations ?? []).map((relation) =>
			tombstoneWrite("cardRelation", relation),
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
	const writes = snapshots.flatMap(
		(snapshot) => planArchiveCard(snapshot, context).writes,
	);
	const seenRelations = new Set<string>();
	return {
		writes: writes.filter((write) => {
			if (write.entity !== "cardRelation") return true;
			if (seenRelations.has(write.id)) return false;
			seenRelations.add(write.id);
			return true;
		}),
		result: null,
	};
}
