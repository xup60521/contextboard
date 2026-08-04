#!/usr/bin/env bun
import { hostname } from "node:os";
import { createTools } from "@contextboard/agent-tools";
import {
	createRepositoryCanvasService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application/canvas";
import { createRepositoryCardsService } from "@contextboard/application/cards";
import { createRepositoryCardRelationsService } from "@contextboard/application/relations";
import { HttpSyncTransport } from "@contextboard/client-core";
import {
	loadAgentCredentials,
	removeAgentCredentials,
	writeAgentCredentials,
} from "./credentials";
import {
	readAgentServerDiscovery,
	removeAgentServerDiscovery,
	writeAgentServerDiscovery,
} from "./discovery";
import { createAgentHttpApp } from "./http";
import { createReplicaRuntime, type ReplicaRuntime } from "./replica";

const AGENT_SERVER_VERSION = "0.0.0";
const DEFAULT_AGENT_SERVER_PORT = 8790;
const DEVICE_CODE_ENDPOINT = "/api/sync/v1/device";

type ParsedOptions = Record<string, string>;

function parseOptions(
	args: string[],
	allowed: ReadonlySet<string>,
): ParsedOptions {
	const options: ParsedOptions = {};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (!argument?.startsWith("--"))
			throw new Error(`Unexpected argument: ${argument ?? ""}`);
		const equals = argument.indexOf("=");
		const name = equals === -1 ? argument : argument.slice(0, equals);
		if (!allowed.has(name)) throw new Error(`Unknown option: ${name}`);
		const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
		if (!value) throw new Error(`${name} requires a value`);
		options[name] = value;
	}
	return options;
}

function parsePort(value: string | undefined, fallback: number) {
	const port = value === undefined ? fallback : Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Port must be an integer between 1 and 65535");
	return port;
}

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

function sleep(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function resolveLoginServer(
	explicit: string | undefined,
	home: string | undefined,
) {
	if (explicit) return normalizeServerUrl(explicit);
	if (process.env.CONTEXTBOARD_SYNC_URL)
		return normalizeServerUrl(process.env.CONTEXTBOARD_SYNC_URL);
	const fileCredentials = await loadAgentCredentials({
		env: {},
		home,
		warn: () => undefined,
	});
	if (fileCredentials) return normalizeServerUrl(fileCredentials.serverUrl);
	throw new Error(
		"No server URL configured; pass --server URL or set CONTEXTBOARD_SYNC_URL",
	);
}

async function loginCommand(options: ParsedOptions) {
	const serverUrl = await resolveLoginServer(options["--server"], undefined);
	const deviceName = options["--device-name"]?.trim() || hostname();
	const codeResponse = await fetch(`${serverUrl}${DEVICE_CODE_ENDPOINT}/code`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ clientName: "contextboard-cli", deviceName }),
	});
	if (!codeResponse.ok) throw new Error(await readApiError(codeResponse));
	const code = (await codeResponse.json()) as {
		deviceCode: string;
		userCode: string;
		verificationUriComplete: string;
		expiresIn: number;
		interval: number;
	};

	console.log("\nContextBoard device login\n");
	console.log(`  CODE  ${code.userCode}`);
	console.log(`  OPEN  ${code.verificationUriComplete}`);
	console.log(
		"\nApprove this request in the browser, then leave this command running.\n",
	);

	const deadline = Date.now() + code.expiresIn * 1000;
	let interval = Math.max(1, code.interval);
	for (;;) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("Device login expired before approval");
		await sleep(Math.min(interval * 1000, remaining));
		const response = await fetch(`${serverUrl}${DEVICE_CODE_ENDPOINT}/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ deviceCode: code.deviceCode }),
		});
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
			const savedServerUrl =
				typeof body.serverUrl === "string"
					? normalizeServerUrl(body.serverUrl)
					: serverUrl;
			await writeAgentCredentials({
				token: body.token,
				serverUrl: savedServerUrl,
				...(tokenId ? { tokenId } : {}),
			});
			console.log(
				`Logged in with token ${String(body.name ?? "contextboard-cli")}.`,
			);
			return;
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

async function logoutCommand() {
	if (process.env.CONTEXTBOARD_AGENT_TOKEN?.trim()) {
		console.log(
			"Environment-provided credentials are active; logout leaves them untouched.",
		);
		return;
	}
	const credentials = await loadAgentCredentials({
		env: {},
		warn: () => undefined,
	});
	let remoteMessage = "No server-side token id was stored.";
	if (credentials?.tokenId) {
		try {
			const response = await fetch(
				`${credentials.serverUrl}/api/sync/v1/agent-tokens/${encodeURIComponent(credentials.tokenId)}`,
				{
					method: "DELETE",
					headers: { authorization: `Bearer ${credentials.token}` },
				},
			);
			if (response.ok) remoteMessage = "The server token was revoked.";
			else if (response.status === 401 || response.status === 403)
				remoteMessage =
					"The local token was removed; revoke the server token in the Web UI if needed.";
			else
				remoteMessage = `Server revocation returned HTTP ${response.status}.`;
		} catch {
			remoteMessage =
				"The local token was removed; the server could not be reached for revocation.";
		}
	}
	const removed = await removeAgentCredentials();
	console.log(
		`${removed ? "Local credentials removed." : "No local credentials file found."} ${remoteMessage}`,
	);
}

async function statusCommand() {
	const discovery = await readAgentServerDiscovery().catch(() => null);
	const local = discovery
		? await fetch(`http://127.0.0.1:${discovery.port}/api/v1/_health`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			})
				.then(async (response) => {
					if (!response.ok) return null;
					return (await response.json()) as {
						workspaceId?: string;
						port?: number;
					};
				})
				.catch(() => null)
		: null;
	const credentials = await loadAgentCredentials({ warn: () => undefined });
	let cloudWorkspace: string | null = null;
	if (credentials) {
		const transport = new HttpSyncTransport({
			baseURL: credentials.serverUrl,
			credentials: "omit",
			getAuthHeaders: () => ({
				authorization: `Bearer ${credentials.token}`,
			}),
		});
		const listing = await transport.listWorkspaces();
		cloudWorkspace =
			listing.workspaces.find((workspace) => workspace.isDefault)
				?.workspaceId ??
			listing.workspaces[0]?.workspaceId ??
			null;
	}
	if (!local && !credentials)
		throw new Error(
			"No running agent server or credentials found; enable the agent server in ContextBoard or run `contextboard serve`.",
		);

	const workspaceId = local?.workspaceId ?? cloudWorkspace ?? "unknown";
	const port = local?.port ?? discovery?.port ?? "not-running";
	console.log(`workspace: ${workspaceId}`);
	console.log(`port: ${port}`);
	console.log(`cloud: ${credentials ? "live" : "not checked"}`);
}

async function serveCommand(options: ParsedOptions) {
	const port = parsePort(options["--port"], DEFAULT_AGENT_SERVER_PORT);
	const runtime: ReplicaRuntime = await createReplicaRuntime();
	const { repository, workspaceId } = runtime;

	const tools = createTools({
		cards: createRepositoryCardsService(repository),
		whiteboards: createRepositoryWhiteboardsService(repository, {
			workspaceId,
		}),
		canvas: createRepositoryCanvasService(repository, { workspaceId }),
		relations: createRepositoryCardRelationsService(repository),
	});
	const app = createAgentHttpApp(tools, {
		mode: "replica",
		workspaceId,
		version: AGENT_SERVER_VERSION,
		port,
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		fetch: app.fetch,
	});
	const boundPort = server.port ?? port;
	const discoveryLease = await writeAgentServerDiscovery(boundPort, "replica");
	console.log(
		`ContextBoard agent server listening on 127.0.0.1:${boundPort} (replica, workspace ${workspaceId})`,
	);

	let closed = false;
	let resolveStopped!: () => void;
	const stopped = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});
	const shutdown = async () => {
		if (closed) return;
		closed = true;
		try {
			// Drain the replica while its database is still open and before the
			// HTTP listener is closed. `close` repeats the flush defensively.
			await runtime.flush();
			await server.stop();
			await removeAgentServerDiscovery(
				boundPort,
				"replica",
				undefined,
				discoveryLease.identity,
			);
		} finally {
			try {
				await runtime.close();
			} finally {
				resolveStopped();
			}
		}
	};
	process.once("SIGINT", () => void shutdown());
	process.once("SIGTERM", () => void shutdown());
	await stopped;
}

function usage() {
	return `Usage:
	  contextboard serve [--port PORT]
  contextboard login [--server URL] [--device-name NAME]
  contextboard logout
  contextboard status`;
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (!command) throw new Error(usage());
	if (command === "serve") {
		await serveCommand(parseOptions(args, new Set(["--port"])));
		return;
	}
	if (command === "login") {
		await loginCommand(
			parseOptions(args, new Set(["--server", "--device-name"])),
		);
		return;
	}
	if (command === "logout") {
		if (args.length) throw new Error(usage());
		await logoutCommand();
		return;
	}
	if (command === "status") {
		if (args.length) throw new Error(usage());
		await statusCommand();
		return;
	}
	throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
