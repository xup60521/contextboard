#!/usr/bin/env bun
import { hostname } from "node:os";
import { createTools } from "@contextboard/agent-tools";
import {
	createRepositoryCanvasService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application/canvas";
import { createRepositoryCardsService } from "@contextboard/application/cards";
import { createRepositoryCardRelationsService } from "@contextboard/application/relations";
import {
	loadAgentCredentials,
	NOT_LOGGED_IN_MESSAGE,
	removeAgentCredentials,
} from "./credentials";
import {
	fetchDefaultWorkspaceId,
	resolveLoginServer,
	runDeviceLogin,
} from "./device-login";
import {
	readAgentServerDiscovery,
	removeAgentServerDiscovery,
	writeAgentServerDiscovery,
} from "./discovery";
import { createAgentHttpApp } from "./http";
import { createReplicaRuntime, type ReplicaRuntime } from "./replica";
import { startReplicaSyncLoop } from "./replica-sync-loop";
import { loadAgentSkill } from "./skill";

const AGENT_SERVER_VERSION = "0.0.0";
const DEFAULT_AGENT_SERVER_PORT = 8790;

type ParsedOptions = Record<string, string>;

function parseOptions(
	args: string[],
	allowed: ReadonlySet<string>,
	flags: ReadonlySet<string> = new Set(),
): ParsedOptions {
	const options: ParsedOptions = {};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (!argument?.startsWith("--"))
			throw new Error(`Unexpected argument: ${argument ?? ""}`);
		const equals = argument.indexOf("=");
		const name = equals === -1 ? argument : argument.slice(0, equals);
		if (flags.has(name)) {
			if (equals !== -1) throw new Error(`${name} does not take a value`);
			options[name] = "true";
			continue;
		}
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

async function startDeviceLogin(options: ParsedOptions) {
	const serverUrl = await resolveLoginServer(options["--server"]);
	return runDeviceLogin({
		serverUrl,
		deviceName: options["--device-name"]?.trim() || hostname(),
		openBrowser: !options["--no-browser"],
	});
}

async function loginCommand(options: ParsedOptions) {
	await startDeviceLogin(options);
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
	const cloudWorkspace = credentials
		? await fetchDefaultWorkspaceId(credentials)
		: null;
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

/**
 * A fresh box has no credentials, and the fix for that is a device login rather
 * than a manual token paste — so run it here instead of failing. `--no-login`
 * (or `CONTEXTBOARD_NO_LOGIN`) restores the fail-fast behaviour for containers
 * and service managers, where a login prompt nobody can answer would look like
 * a hang.
 */
async function resolveServeCredentials(options: ParsedOptions) {
	const existing = await loadAgentCredentials();
	if (existing) return existing;
	if (options["--no-login"] || process.env.CONTEXTBOARD_NO_LOGIN?.trim())
		throw new Error(NOT_LOGGED_IN_MESSAGE);
	// Kept ASCII: this line is often read through a redirected Windows pipe or a
	// service log, where a non-ASCII dash turns into mojibake.
	console.log("No ContextBoard credentials found; starting device login.");
	return startDeviceLogin(options);
}

async function serveCommand(options: ParsedOptions) {
	const port = parsePort(options["--port"], DEFAULT_AGENT_SERVER_PORT);
	const credentials = await resolveServeCredentials(options);
	const runtime: ReplicaRuntime = await createReplicaRuntime({ credentials });
	const { repository, workspaceId } = runtime;

	const tools = createTools({
		cards: createRepositoryCardsService(repository),
		whiteboards: createRepositoryWhiteboardsService(repository, {
			workspaceId,
		}),
		canvas: createRepositoryCanvasService(repository, { workspaceId }),
		relations: createRepositoryCardRelationsService(repository),
	});
	const skill = loadAgentSkill();
	const app = createAgentHttpApp(tools, {
		mode: "replica",
		workspaceId,
		version: AGENT_SERVER_VERSION,
		port,
		skillMarkdown: skill.markdown,
		skillEtag: skill.etag,
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		fetch: app.fetch,
	});
	const boundPort = server.port ?? port;
	const discoveryLease = await writeAgentServerDiscovery(boundPort, "replica");
	const stopReplicaSync = startReplicaSyncLoop({
		sync: runtime.flush,
		retryDelay: () => runtime.coordinator.retryDelay(),
		onError: (error) => {
			const kind =
				error instanceof Error && error.name ? error.name : "UnknownError";
			console.error(`Replica sync failed (${kind})`);
		},
	});
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
		stopReplicaSync();
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
  contextboard serve [--port PORT] [--server URL] [--device-name NAME] [--no-login] [--no-browser]
  contextboard login [--server URL] [--device-name NAME] [--no-browser]
  contextboard logout
  contextboard status

serve logs in automatically when the box has no credentials.`;
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (!command) throw new Error(usage());
	if (command === "serve") {
		await serveCommand(
			parseOptions(
				args,
				new Set(["--port", "--server", "--device-name"]),
				new Set(["--no-login", "--no-browser"]),
			),
		);
		return;
	}
	if (command === "login") {
		await loginCommand(
			parseOptions(
				args,
				new Set(["--server", "--device-name"]),
				new Set(["--no-browser"]),
			),
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
