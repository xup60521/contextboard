#!/usr/bin/env bun
/**
 * ContextBoard agent gateway.
 *
 * An MCP server that lets a coding agent read and write a ContextBoard
 * workspace. In bridge mode it talks to the running desktop app over its
 * loopback bridge. In replica mode it owns a persistent SQLite replica and
 * synchronizes with the cloud using a headless agent token.
 *
 * Bridge mode remains the default so existing laptop installations are
 * unchanged; remote boxes opt into replica mode explicitly.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createRepositoryCanvasService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application/canvas";
import { createRepositoryCardsService } from "@contextboard/application/cards";
import { createRepositoryCardRelationsService } from "@contextboard/application/relations";
import type { WorkspaceRepository } from "@contextboard/client-core";
import {
	connectBridgeRepository,
	DEFAULT_BRIDGE_PORT,
} from "@contextboard/storage-bridge";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createTools, type ToolDefinition } from "./tools";

export type AgentMode = "bridge" | "replica";

export function resolveAgentMode(
	env: Record<string, string | undefined> = process.env,
): AgentMode {
	const mode = env.CONTEXTBOARD_AGENT_MODE?.trim().toLowerCase() || "bridge";
	if (mode === "bridge" || mode === "replica") return mode;
	throw new Error(
		`Invalid CONTEXTBOARD_AGENT_MODE "${mode}"; expected bridge or replica`,
	);
}

/**
 * The desktop app publishes its live port here on start, so the common case
 * needs no configuration. An explicit env var still wins.
 */
export async function resolveBridgePort(
	env: Record<string, string | undefined> = process.env,
	readDiscoveryFile: () => Promise<string> = () =>
		readFile(join(homedir(), ".contextboard", "bridge.json"), "utf8"),
): Promise<number> {
	const configured = Number(env.CONTEXTBOARD_BRIDGE_PORT);
	if (Number.isInteger(configured) && configured > 0 && configured < 65536) {
		return configured;
	}
	try {
		const parsed = JSON.parse(await readDiscoveryFile()) as { port?: unknown };
		if (
			typeof parsed.port === "number" &&
			Number.isInteger(parsed.port) &&
			parsed.port > 0
		) {
			return parsed.port;
		}
	} catch {
		// No discovery file: the app may never have enabled the bridge. Fall
		// through to the default so the connection error names the real problem.
	}
	return DEFAULT_BRIDGE_PORT;
}

async function main() {
	const mode = resolveAgentMode();
	let repository: WorkspaceRepository;
	let workspaceId: string;
	let cleanup: () => Promise<void> = async () => undefined;
	let bridgePort: number | null = null;
	if (mode === "replica") {
		const { createReplicaRuntime } = await import("./replica");
		const runtime = await createReplicaRuntime();
		repository = runtime.repository;
		workspaceId = runtime.workspaceId;
		cleanup = runtime.close;
	} else {
		bridgePort = await resolveBridgePort();
		const connected = await connectBridgeRepository({ port: bridgePort });
		repository = connected.repository;
		workspaceId = connected.status.workspaceId;
	}
	// The canvas services need the workspace the desktop app has adopted: it is
	// what marks a card as belonging here rather than to a paste from elsewhere.
	const tools = createTools({
		cards: createRepositoryCardsService(repository),
		whiteboards: createRepositoryWhiteboardsService(repository, {
			workspaceId,
		}),
		canvas: createRepositoryCanvasService(repository, { workspaceId }),
		relations: createRepositoryCardRelationsService(repository),
	});
	const byName = new Map<string, ToolDefinition>(
		tools.map((tool) => [tool.name, tool]),
	);

	const server = new Server(
		{ name: "contextboard", version: "0.0.0" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: tools.map(({ name, description, inputSchema }) => ({
			name,
			description,
			inputSchema,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = byName.get(request.params.name);
		if (!tool) {
			return {
				isError: true,
				content: [
					{ type: "text", text: `Unknown tool: ${request.params.name}` },
				],
			};
		}
		try {
			const result = await tool.handler(
				(request.params.arguments ?? {}) as Record<string, unknown>,
			);
			return {
				content: [
					{ type: "text", text: JSON.stringify(result ?? null, null, 2) },
				],
			};
		} catch (error) {
			// Surfaced to the agent rather than thrown, so it can correct itself
			// instead of losing the conversation to a protocol error.
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: error instanceof Error ? error.message : String(error),
					},
				],
			};
		}
	});

	const transport = new StdioServerTransport();
	let closed = false;
	const shutdown = async (exit: boolean) => {
		if (closed) {
			if (exit) process.exit(0);
			return;
		}
		closed = true;
		try {
			await cleanup();
		} catch (error) {
			process.stderr.write(
				`ContextBoard flush failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		await transport.close().catch(() => undefined);
		if (exit) process.exit(0);
	};
	transport.onclose = () => {
		void shutdown(false);
	};
	process.once("SIGINT", () => {
		void shutdown(true);
	});
	process.once("SIGTERM", () => {
		void shutdown(true);
	});
	process.stdin.once("end", () => {
		void shutdown(false);
	});
	process.stdin.once("close", () => {
		void shutdown(false);
	});
	try {
		await server.connect(transport);
	} catch (error) {
		await shutdown(false);
		throw error;
	}
	// stdout carries the protocol, so status goes to stderr.
	process.stderr.write(
		`ContextBoard MCP ready on workspace ${workspaceId} (${mode}${
			bridgePort ? ` port ${bridgePort}` : ""
		})\n`,
	);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	});
}
