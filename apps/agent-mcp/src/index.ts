#!/usr/bin/env bun
/**
 * ContextBoard agent gateway.
 *
 * An MCP server that lets a coding agent read and write a ContextBoard
 * workspace. It holds no credentials: it talks to the running desktop app over
 * its loopback bridge, and the desktop app owns authentication and
 * synchronization. A write here lands in the desktop's local store and is
 * pushed to the sync server by the app's own coordinator, so it reaches every
 * other device the same way a hand-made edit would.
 *
 * The server therefore only works while the desktop app is running with the
 * agent bridge enabled in its settings.
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
	const port = await resolveBridgePort();
	const { repository, status } = await connectBridgeRepository({ port });
	const workspaceId = status.workspaceId;
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

	await server.connect(new StdioServerTransport());
	// stdout carries the protocol, so status goes to stderr.
	process.stderr.write(
		`ContextBoard MCP ready on workspace ${workspaceId} (bridge port ${port})\n`,
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
