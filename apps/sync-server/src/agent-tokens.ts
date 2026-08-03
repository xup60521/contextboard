import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credentials for headless agents: a coding agent on a remote box has no
 * browser for the GitHub popup and no OS keyring to hold the result, so it
 * cannot use the desktop handoff flow. An agent token is a long-lived,
 * revocable bearer credential the user issues from the Web UI and drops on the
 * box, the same shape as `gh auth login --with-token`.
 *
 * Only the hash is ever stored, so a database leak does not yield usable
 * credentials. A plain SHA-256 is the right choice here — unlike a password,
 * the token is 256 bits of machine-generated entropy, so there is nothing for
 * an attacker to guess and a slow KDF would only tax legitimate requests.
 */
export const AGENT_TOKEN_PREFIX = "cbat_";

/** 32 bytes of entropy, base64url encoded to stay copy-paste safe. */
export function generateAgentToken() {
	return `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAgentToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

export function isAgentToken(value: string): boolean {
	return value.startsWith(AGENT_TOKEN_PREFIX);
}

/**
 * Compares two hex hashes without leaking their contents through timing. The
 * lookup itself is by primary key, so this only guards the final check.
 */
export function hashesMatch(left: string, right: string) {
	const a = Buffer.from(left, "hex");
	const b = Buffer.from(right, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Extracts a bearer credential. Better Auth's own session tokens arrive the
 * same way, so callers must use {@link isAgentToken} to tell them apart rather
 * than assuming every bearer value is an agent token.
 */
export function readBearerToken(request: Request): string | null {
	const header = request.headers.get("authorization");
	if (!header) return null;
	const [scheme, ...rest] = header.split(" ");
	if (scheme?.toLowerCase() !== "bearer") return null;
	const value = rest.join(" ").trim();
	return value || null;
}

/** A bad request from the user, not a fault: routed to 400 without logging. */
export class AgentTokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentTokenError";
	}
}

export function parseAgentTokenName(value: unknown) {
	if (typeof value !== "string")
		throw new AgentTokenError("Agent token name must be a string");
	const name = value.trim();
	if (!name) throw new AgentTokenError("Agent token name is required");
	if (name.length > 64)
		throw new AgentTokenError(
			"Agent token name must be 64 characters or fewer",
		);
	return name;
}
