import type { SyncEntityType } from "@contextboard/sync-protocol";

export type EntityWrite = {
	entity: SyncEntityType;
	operation: "upsert" | "delete";
	id: string;
	value?: unknown;
	expectedRevision?: number;
};

export type WorkspaceCommandInput =
	| { value: unknown }
	| { writes: EntityWrite[] };

export class WorkspaceConflictError extends Error {
	readonly code = "CONFLICT";

	constructor(message = "The entity was updated elsewhere") {
		super(message);
		this.name = "WorkspaceConflictError";
	}
}

export function isWorkspaceConflict(error: unknown): boolean {
	return (
		error instanceof WorkspaceConflictError ||
		(error instanceof Error &&
			(error.name === "CONFLICT" ||
				(error as Error & { code?: string }).code === "CONFLICT"))
	);
}

export async function withRetry<T>(
	operation: () => Promise<T>,
	options: {
		attempts?: number;
		delay?: (attempt: number) => Promise<void>;
	} = {},
): Promise<T> {
	const attempts = options.attempts ?? 3;
	const delay =
		options.delay ??
		((attempt: number) =>
			new Promise((resolve) =>
				setTimeout(resolve, 5 * 2 ** attempt + Math.random() * 10),
			));
	for (let attempt = 0; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (!isWorkspaceConflict(error) || attempt + 1 >= attempts) throw error;
			await delay(attempt);
		}
	}
}
