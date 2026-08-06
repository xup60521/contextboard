import { platform } from "node:os";
import { HttpSyncTransport } from "@contextboard/client-core";
import type { AgentCredentials } from "./credentials";
import { loadAgentCredentials, writeAgentCredentials } from "./credentials";

/**
 * The RFC 8628 device flow, as driven from the CLI side. The server half lives
 * in `apps/sync-server/src/app.ts` (`/api/sync/v1/device/*`) and the browser
 * approval page in `apps/web/src/routes/device.tsx`.
 *
 * This is deliberately separate from `cli.ts` so that `serve` can bootstrap a
 * login in-process on a box that has never been configured, rather than telling
 * the operator to go and run a second command.
 */

/**
 * The deployed Worker origin, so `contextboard login` needs no arguments. It is
 * the same origin the desktop shell already trusts in its `connect-src` policy
 * (apps/desktop/src-tauri/tauri.conf.json). Self-hosted deployments override it
 * with `--server` or `CONTEXTBOARD_SYNC_URL`.
 */
export const DEFAULT_SYNC_URL = "https://contextboard.xup60521.workers.dev";

export const DEVICE_CODE_ENDPOINT = "/api/sync/v1/device";

function normalizeServerUrl(value: string) {
	const url = new URL(value);
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error("Server URL must use http or https");
	return url.origin;
}

async function readApiError(response: Response) {
	const body = (await response.json().catch(() => null)) as {
		error?: unknown;
		error_description?: unknown;
	} | null;
	return typeof body?.error_description === "string"
		? body.error_description
		: typeof body?.error === "string"
			? body.error
			: `Request failed with status ${response.status}`;
}

function defaultSleep(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Resolution order: explicit flag, environment, an existing credentials file,
 * then the deployed default. Only the first two are ever set by hand, which is
 * the point — a fresh box needs none of them.
 */
export async function resolveLoginServer(
	explicit: string | undefined,
	options: {
		env?: Record<string, string | undefined>;
		home?: string;
		loadCredentials?: typeof loadAgentCredentials;
	} = {},
) {
	if (explicit) return normalizeServerUrl(explicit);
	const env = options.env ?? process.env;
	if (env.CONTEXTBOARD_SYNC_URL?.trim())
		return normalizeServerUrl(env.CONTEXTBOARD_SYNC_URL.trim());
	const load = options.loadCredentials ?? loadAgentCredentials;
	const fileCredentials = await load({
		env: {},
		home: options.home,
		warn: () => undefined,
	});
	if (fileCredentials) return normalizeServerUrl(fileCredentials.serverUrl);
	return DEFAULT_SYNC_URL;
}

/**
 * Opening a browser is a convenience, never a requirement: the code and URL are
 * printed regardless, so an SSH session or a service manager is no worse off
 * than before. Guessing wrong on a headless box would spawn a process that
 * nobody can see, so the obvious signals opt out.
 */
export function shouldOpenBrowser(
	options: { env?: Record<string, string | undefined>; isTty?: boolean } = {},
) {
	const env = options.env ?? process.env;
	if (env.CONTEXTBOARD_NO_BROWSER?.trim()) return false;
	if (env.SSH_CONNECTION?.trim() || env.SSH_TTY?.trim()) return false;
	return options.isTty ?? Boolean(process.stdout.isTTY);
}

/**
 * Best effort and non-blocking. The child is detached and its streams ignored
 * so a browser that outlives the CLI cannot hold the login open or scribble
 * over the printed code.
 */
export function openInBrowser(url: string, currentPlatform = platform()) {
	const command =
		currentPlatform === "win32"
			? ["cmd", "/c", "start", "", url]
			: currentPlatform === "darwin"
				? ["open", url]
				: ["xdg-open", url];
	try {
		const child = Bun.spawn(command, {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		child.unref();
		return true;
	} catch {
		return false;
	}
}

/** Reads the account's default workspace, used as a post-login token probe. */
export async function fetchDefaultWorkspaceId(credentials: AgentCredentials) {
	const transport = new HttpSyncTransport({
		baseURL: credentials.serverUrl,
		credentials: "omit",
		getAuthHeaders: () => ({
			authorization: `Bearer ${credentials.token}`,
		}),
	});
	const listing = await transport.listWorkspaces();
	return (
		listing.workspaces.find((workspace) => workspace.isDefault)?.workspaceId ??
		listing.workspaces[0]?.workspaceId ??
		null
	);
}

export type DeviceLoginOptions = {
	serverUrl: string;
	deviceName: string;
	/** False when `--no-browser` was passed; other opt-outs are detected here. */
	openBrowser?: boolean;
	env?: Record<string, string | undefined>;
	isTty?: boolean;
	fetch?: typeof globalThis.fetch;
	sleep?: (milliseconds: number) => Promise<void>;
	now?: () => number;
	log?: (message: string) => void;
	warn?: (message: string) => void;
	open?: (url: string) => boolean;
	writeCredentials?: (
		credentials: AgentCredentials,
	) => Promise<string | undefined>;
	probeWorkspace?: (credentials: AgentCredentials) => Promise<string | null>;
};

type DeviceCodeResponse = {
	deviceCode: string;
	userCode: string;
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
};

/**
 * Requests a device code, waits for the browser approval, and persists the
 * agent token. Returns the credentials so a caller that needs them immediately
 * — `serve` — does not have to read the file back.
 */
export async function runDeviceLogin(
	options: DeviceLoginOptions,
): Promise<AgentCredentials> {
	const {
		serverUrl,
		deviceName,
		fetch: fetchImpl = globalThis.fetch,
		sleep = defaultSleep,
		now = Date.now,
		log = (message: string) => console.log(message),
		warn = (message: string) => console.warn(message),
		open = openInBrowser,
		writeCredentials = writeAgentCredentials,
		probeWorkspace = fetchDefaultWorkspaceId,
	} = options;

	const codeResponse = await fetchImpl(
		`${serverUrl}${DEVICE_CODE_ENDPOINT}/code`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ clientName: "contextboard-cli", deviceName }),
		},
	);
	if (!codeResponse.ok) throw new Error(await readApiError(codeResponse));
	const code = (await codeResponse.json()) as DeviceCodeResponse;

	const opened =
		options.openBrowser !== false &&
		shouldOpenBrowser({ env: options.env, isTty: options.isTty }) &&
		open(code.verificationUriComplete);

	log("\nContextBoard device login\n");
	log(`  CODE  ${code.userCode}`);
	log(`  OPEN  ${code.verificationUriComplete}`);
	log(
		opened
			? "\nYour browser is opening that page. Approve the request, then leave this command running.\n"
			: "\nApprove this request in the browser, then leave this command running.\n",
	);

	const deadline = now() + code.expiresIn * 1000;
	let interval = Math.max(1, code.interval);
	for (;;) {
		const remaining = deadline - now();
		if (remaining <= 0) throw new Error("Device login expired before approval");
		await sleep(Math.min(interval * 1000, remaining));
		const response = await fetchImpl(
			`${serverUrl}${DEVICE_CODE_ENDPOINT}/token`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ deviceCode: code.deviceCode }),
			},
		);
		const body = (await response.json().catch(() => null)) as {
			token?: unknown;
			tokenId?: unknown;
			name?: unknown;
			serverUrl?: unknown;
			error?: unknown;
			error_description?: unknown;
			interval?: unknown;
		} | null;
		if (response.ok && typeof body?.token === "string") {
			const tokenId =
				typeof body.tokenId === "string" ? body.tokenId : undefined;
			// The server reports its own public origin, which is authoritative: a
			// `--server` pointing at an alias must not be what we store.
			const savedServerUrl =
				typeof body.serverUrl === "string"
					? normalizeServerUrl(body.serverUrl)
					: serverUrl;
			const credentials: AgentCredentials = {
				token: body.token,
				serverUrl: savedServerUrl,
				...(tokenId ? { tokenId } : {}),
			};
			await writeCredentials(credentials);
			log(`Logged in with token ${String(body.name ?? "contextboard-cli")}.`);
			// The token is already saved, so a failed probe is a warning: it means
			// the account is not on the allowlist, which is worth saying now rather
			// than leaving to the first sync.
			try {
				const workspaceId = await probeWorkspace(credentials);
				if (workspaceId) log(`Workspace: ${workspaceId}`);
			} catch (error) {
				warn(
					`Saved the token, but the server rejected it: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			return credentials;
		}
		const error = body?.error;
		if (error === "authorization_pending") continue;
		if (error === "slow_down") {
			const returnedInterval =
				typeof body?.interval === "number" ? body.interval : interval + 5;
			const retryAfter = Number(response.headers.get("retry-after"));
			interval = Math.max(
				interval + 5,
				returnedInterval,
				Number.isFinite(retryAfter) ? retryAfter : 0,
			);
			continue;
		}
		if (error === "access_denied")
			throw new Error("The user denied this device login");
		if (error === "expired_token") throw new Error("Device login expired");
		throw new Error(
			typeof body?.error_description === "string"
				? body.error_description
				: `Device login failed (${response.status})`,
		);
	}
}
