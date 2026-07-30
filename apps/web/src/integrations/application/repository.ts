import type { ContextboardDatabase } from "@contextboard/local-db";
import { IndexedDbWorkspaceRepository } from "@contextboard/storage-indexeddb";

const repositories = new WeakMap<
	ContextboardDatabase,
	IndexedDbWorkspaceRepository
>();

export function getWebWorkspaceRepository(
	database: ContextboardDatabase,
): IndexedDbWorkspaceRepository {
	let repository = repositories.get(database);
	if (!repository) {
		repository = new IndexedDbWorkspaceRepository(database);
		repositories.set(database, repository);
	}
	return repository;
}
