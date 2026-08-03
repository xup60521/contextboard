import { readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Credentials for a headless agent box.
 *
 * The desktop shell authenticates through a GitHub popup and stores the result
 * in the OS keyring; a remote box has neither a browser nor a keyring, so it
 * reads a long-lived agent token issued from the Web UI instead. This module
 * only locates and validates that token — see `apps/sync-server/src/agent-tokens.ts`
 * for how it is minted and revoked.
 */
export type AgentCredentials = {
	token: string;
	/** Origin of the public endpoint, i.e. the Worker, not the sync server. */
	serverUrl: string;
};

export const CREDENTIALS_DIRECTORY = ".contextboard";
export const CREDENTIALS_FILENAME = "credentials.json";

export class CredentialsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CredentialsError";
	}
}

export function credentialsPath(home = homedir()) {
	return join(home, CREDENTIALS_DIRECTORY, CREDENTIALS_FILENAME);
}

/**
 * POSIX permission check. A token readable by other accounts on a shared box is
 * a real exposure, but refusing to start would be worse than saying so — the
 * agent is often unattended. Windows ACLs are not modelled by st_mode, so the
 * check would be meaningless there and is skipped.
 */
export async function checkCredentialsPermissions(
	path: string,
	options: {
		statFile?: (target: string) => Promise<{ mode: number }>;
		currentPlatform?: string;
	} = {},
): Promise<string | null> {
	const currentPlatform = options.currentPlatform ?? platform();
	if (currentPlatform === "win32") return null;
	const statFile = options.statFile ?? ((target: string) => stat(target));
	const { mode } = await statFile(path);
	// Any bit set below the owner triple means group or others can reach it.
	if ((mode & 0o077) === 0) return null;
	return `${path} is readable by other users (mode ${(mode & 0o777)
		.toString(8)
		.padStart(3, "0")}); run: chmod 600 ${path}`;
}

function parseCredentials(raw: string, source: string): AgentCredentials {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CredentialsError(`${source} is not valid JSON`);
	}
	const record = parsed as { token?: unknown; serverUrl?: unknown };
	if (typeof record?.token !== "string" || !record.token.trim())
		throw new CredentialsError(`${source} is missing a "token" string`);
	if (typeof record?.serverUrl !== "string" || !record.serverUrl.trim())
		throw new CredentialsError(`${source} is missing a "serverUrl" string`);
	return {
		token: record.token.trim(),
		serverUrl: record.serverUrl.trim().replace(/\/+$/, ""),
	};
}

/**
 * Resolves credentials, preferring the environment so a container or CI job can
 * inject them without writing a file. Returns null when nothing is configured,
 * which callers treat as "not a headless install" rather than an error.
 */
export async function loadAgentCredentials(
	options: {
		env?: Record<string, string | undefined>;
		home?: string;
		readCredentialsFile?: (path: string) => Promise<string>;
		statFile?: (target: string) => Promise<{ mode: number }>;
		currentPlatform?: string;
		warn?: (message: string) => void;
	} = {},
): Promise<AgentCredentials | null> {
	const env = options.env ?? process.env;
	const warn = options.warn ?? ((message: string) => console.warn(message));

	const envToken = env.CONTEXTBOARD_AGENT_TOKEN?.trim();
	if (envToken) {
		const serverUrl = env.CONTEXTBOARD_SYNC_URL?.trim();
		if (!serverUrl)
			throw new CredentialsError(
				"CONTEXTBOARD_SYNC_URL is required when CONTEXTBOARD_AGENT_TOKEN is set",
			);
		return { token: envToken, serverUrl: serverUrl.replace(/\/+$/, "") };
	}

	const path = credentialsPath(options.home);
	const read =
		options.readCredentialsFile ??
		((target: string) => readFile(target, "utf8"));
	let raw: string;
	try {
		raw = await read(path);
	} catch {
		return null;
	}

	const warning = await checkCredentialsPermissions(path, options).catch(
		() => null,
	);
	if (warning) warn(warning);
	return parseCredentials(raw, path);
}
