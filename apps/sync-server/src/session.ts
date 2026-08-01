import type { ContextboardAuth } from "@contextboard/auth";
import { type AllowedEmailSet, isAllowedUser } from "./access";
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

export class WorkspaceRedirectError extends Error {
	readonly status = 410 as const;

	constructor(readonly redirectWorkspaceId: string) {
		super("Workspace has been merged into another workspace");
		this.name = "WorkspaceRedirectError";
	}
}

export async function requireWorkspaceSession(
	auth: ContextboardAuth,
	store: SyncStore,
	request: Request,
	workspaceId: string,
	allowedEmails?: AllowedEmailSet,
) {
	const session = await requireSession(auth, request, allowedEmails);
	const redirect = store.getWorkspaceRedirect(workspaceId, session.user.id);
	if (redirect) throw new WorkspaceRedirectError(redirect.toWorkspaceId);
	if (!store.isWorkspaceMember(workspaceId, session.user.id)) {
		throw new SessionAccessError(403, "Forbidden");
	}
	return session;
}

export async function requireSession(
	auth: ContextboardAuth,
	request: Request,
	allowedEmails?: AllowedEmailSet,
) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) throw new SessionAccessError(401, "Unauthorized");
	if (allowedEmails && !isAllowedUser(session.user, allowedEmails))
		throw new SessionAccessError(403, "Forbidden");
	return session;
}
