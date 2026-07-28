import type { ContextboardAuth } from "@contextboard/auth";
import type { SyncStore } from "./store";

export class SessionAccessError extends Error {
	constructor(
		readonly status: 401 | 403,
		message: string,
	) {
		super(message);
		this.name = "SessionAccessError";
	}
}

export async function requireWorkspaceSession(
	auth: ContextboardAuth,
	store: SyncStore,
	request: Request,
	workspaceId: string,
) {
	const session = await requireSession(auth, request);
	if (!store.isWorkspaceMember(workspaceId, session.user.id)) {
		throw new SessionAccessError(403, "Forbidden");
	}
	return session;
}

export async function requireSession(auth: ContextboardAuth, request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) throw new SessionAccessError(401, "Unauthorized");
	return session;
}
