import type { EntityWrite } from "../workspace";

export type Plan<TResult> = {
	writes: EntityWrite[];
	result: TResult;
};

export type PlannerContext = {
	now: number;
	createId: () => string;
};

export function upsertWrite(
	entity: EntityWrite["entity"],
	value: Record<string, unknown> & { id: string; revision?: number },
	expectedRevision = value.revision,
): EntityWrite {
	const { revision: _revision, ...domainValue } = value;
	return {
		entity,
		operation: "upsert",
		id: value.id,
		value: domainValue,
		...(expectedRevision === undefined ? {} : { expectedRevision }),
	};
}

export function tombstoneWrite(
	entity: EntityWrite["entity"],
	value: { id: string; revision: number },
): EntityWrite {
	return {
		entity,
		operation: "delete",
		id: value.id,
		expectedRevision: value.revision,
	};
}
