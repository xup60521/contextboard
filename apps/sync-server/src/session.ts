import type { ContextboardAuth } from "@contextboard/auth";
import type { AllowedEmailSet } from "./access";
import { isAllowedUser } from "./access";
import { isAgentToken, readBearerToken } from "./agent-tokens";
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

/**
 * The caller behind a request, normalized across the two ways of proving
 * identity: a browser session from the GitHub flow, or an agent token on a
 * headless box. Everything downstream authorizes on `user.id`, so both arrive
 * in the same shape and no route needs to know which was used.
 */
export type RequestSession = {
	user: { id: string; email: string | null; emailVerified: boolean };
	/** Set only when the caller authenticated with an agent token. */
	agentTokenId: string | null;
};

export async function requireWorkspaceSession(
	auth: ContextboardAuth,
	store: SyncStore,
	request: Request,
	workspaceId: string,
	allowedEmails?: AllowedEmailSet,
): Promise<RequestSession> {
	const session = await requireSession(auth, store, request, allowedEmails);
	const redirect = store.getWorkspaceRedirect(workspaceId, session.user.id);
	if (redirect) throw new WorkspaceRedirectError(redirect.toWorkspaceId);
	if (!store.isWorkspaceMember(workspaceId, session.user.id)) {
		throw new SessionAccessError(403, "Forbidden");
	}
	return session;
}

export async function requireSession(
	auth: ContextboardAuth,
	store: SyncStore,
	request: Request,
	allowedEmails?: AllowedEmailSet,
): Promise<RequestSession> {
	const bearer = readBearerToken(request);
	if (bearer && isAgentToken(bearer)) {
		const token = store.findActiveAgentToken(bearer);
		// Unknown and revoked tokens are indistinguishable here, by design.
		if (!token) throw new SessionAccessError(401, "Unauthorized");
		// Tokens are only issued to sessions that already cleared the allowlist,
		// which requires a verified address. The allowlist is re-checked below
		// against the live set, so removing an email disables its tokens too.
		const user = {
			id: token.userId,
			email: token.userEmail,
			emailVerified: true,
		};
		if (allowedEmails && !isAllowedUser(user, allowedEmails))
			throw new SessionAccessError(403, "Forbidden");
		store.touchAgentToken(token.id);
		return { user, agentTokenId: token.id };
	}

	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) throw new SessionAccessError(401, "Unauthorized");
	if (allowedEmails && !isAllowedUser(session.user, allowedEmails))
		throw new SessionAccessError(403, "Forbidden");
	return {
		user: {
			id: session.user.id,
			email: session.user.email ?? null,
			emailVerified: session.user.emailVerified === true,
		},
		agentTokenId: null,
	};
}

/**
 * For routes an agent must never reach. Managing agent tokens is the important
 * case: a leaked token that could mint further tokens would survive its own
 * revocation, so issuing and revoking require a real browser session.
 */
export async function requireUserSession(
	auth: ContextboardAuth,
	store: SyncStore,
	request: Request,
	allowedEmails?: AllowedEmailSet,
): Promise<RequestSession> {
	const session = await requireSession(auth, store, request, allowedEmails);
	if (session.agentTokenId)
		throw new SessionAccessError(
			403,
			"Agent tokens cannot manage agent tokens",
		);
	return session;
}
