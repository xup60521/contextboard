import type { EntityWrite } from "../../workspace";
import { collectReferenceIds } from "../derive/references";
import { type Plan, upsertWrite } from "../planner";

type FileReference = {
	id: string;
	revision: number;
	fileId: string;
	targetKey: string;
};
type CardReference = {
	id: string;
	revision: number;
	targetCardId: string;
};
type FileRow = Record<string, unknown> & {
	id: string;
	revision: number;
};

export function planReferences(
	snapshot: {
		targetFileReferences: FileReference[];
		allFileReferences: FileReference[];
		cardReferences: CardReference[];
		files: FileRow[];
	},
	input: {
		targetType: "card" | "tldrawDocument";
		targetId: string;
		content: unknown;
	},
	context: { now: number; deviceId: string },
): Plan<null> {
	const writes: EntityWrite[] = [];
	const targetKey = `${input.targetType}:${input.targetId}`;
	const nextFileIds = collectReferenceIds(input.content, "fileId");
	for (const ref of snapshot.targetFileReferences) {
		if (!nextFileIds.has(ref.fileId))
			writes.push({
				entity: "fileReference",
				operation: "delete",
				id: ref.id,
				expectedRevision: ref.revision,
			});
	}
	for (const fileId of nextFileIds) {
		if (snapshot.targetFileReferences.some((ref) => ref.fileId === fileId))
			continue;
		writes.push({
			entity: "fileReference",
			operation: "upsert",
			id: `${targetKey}:${fileId}`,
			value: {
				id: `${targetKey}:${fileId}`,
				createdAt: context.now,
				updatedAt: context.now,
				updatedByDeviceId: context.deviceId,
				deletedAt: null,
				fileId,
				targetKey,
				targetType: input.targetType,
			},
		});
	}
	const affectedFileIds = new Set([
		...snapshot.targetFileReferences.map((ref) => ref.fileId),
		...nextFileIds,
	]);
	for (const file of snapshot.files) {
		if (!affectedFileIds.has(file.id)) continue;
		const refCount =
			snapshot.allFileReferences.filter(
				(ref) => ref.targetKey !== targetKey && ref.fileId === file.id,
			).length + (nextFileIds.has(file.id) ? 1 : 0);
		writes.push(
			upsertWrite(
				"file",
				{
				...file,
				refCount,
				status: refCount > 0 ? "active" : "pending_delete",
				pendingDeleteAt: refCount > 0 ? null : context.now,
				},
				file.revision,
			),
		);
	}

	if (input.targetType === "card") {
		const nextCardIds = collectReferenceIds(input.content, "cardId");
		nextCardIds.delete(input.targetId);
		for (const ref of snapshot.cardReferences) {
			if (!nextCardIds.has(ref.targetCardId))
				writes.push({
					entity: "cardReference",
					operation: "delete",
					id: ref.id,
					expectedRevision: ref.revision,
				});
		}
		for (const targetCardId of nextCardIds) {
			if (
				snapshot.cardReferences.some(
					(ref) => ref.targetCardId === targetCardId,
				)
			)
				continue;
			const referenceId = `${input.targetId}:${targetCardId}`;
			writes.push({
				entity: "cardReference",
				operation: "upsert",
				id: referenceId,
				value: {
					id: referenceId,
					createdAt: context.now,
					updatedAt: context.now,
					updatedByDeviceId: context.deviceId,
					deletedAt: null,
					sourceCardId: input.targetId,
					targetCardId,
				},
			});
		}
	}
	return { writes, result: null };
}
