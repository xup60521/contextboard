import type { ToolDefinition } from "@contextboard/agent-tools";
import type { AgentMode } from "./discovery";
import { guardRequest } from "./guard";

export type AgentHttpInfo = {
	mode: AgentMode;
	workspaceId: string;
	version: string;
	port: number;
};

type AgentErrorCode =
	| "UNKNOWN_TOOL"
	| "INVALID_ARGUMENT"
	| "INTERNAL_ERROR"
	| "FORBIDDEN_ORIGIN"
	| "FORBIDDEN_HOST"
	| "NOT_FOUND"
	| "METHOD_NOT_ALLOWED"
	| "UNSUPPORTED_MEDIA_TYPE";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": JSON_CONTENT_TYPE },
	});
}

function errorResponse(status: number, code: AgentErrorCode, message: string) {
	return jsonResponse({ ok: false, error: { code, message } }, status);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function createAgentHttpApp(
	tools: ToolDefinition[],
	info: AgentHttpInfo,
) {
	const byName = new Map(tools.map((tool) => [tool.name, tool]));

	return {
		async fetch(request: Request): Promise<Response> {
			try {
				const guardError = guardRequest(request, info.port);
				if (guardError)
					return errorResponse(
						guardError.status,
						guardError.code,
						guardError.message,
					);

				const pathname = new URL(request.url).pathname;
				let input: unknown;
				try {
					input = await request.json();
				} catch {
					return errorResponse(
						400,
						"INVALID_ARGUMENT",
						"Request body must be valid JSON",
					);
				}
				if (!isRecord(input))
					return errorResponse(
						400,
						"INVALID_ARGUMENT",
						"Request body must be a JSON object",
					);

				if (pathname === "/api/v1/_health") {
					if (Object.keys(input).length)
						return errorResponse(
							400,
							"INVALID_ARGUMENT",
							"Discovery requests require an empty JSON object",
						);
					return jsonResponse({
						ok: true,
						mode: info.mode,
						workspaceId: info.workspaceId,
						version: info.version,
						port: info.port,
					});
				}
				if (pathname === "/api/v1/_tools") {
					if (Object.keys(input).length)
						return errorResponse(
							400,
							"INVALID_ARGUMENT",
							"Discovery requests require an empty JSON object",
						);
					return jsonResponse(
						tools.map(({ name, description, inputSchema }) => ({
							name,
							description,
							inputSchema,
						})),
					);
				}

				const name = pathname.slice("/api/v1/".length);
				const tool = byName.get(name);
				if (!tool)
					return errorResponse(404, "UNKNOWN_TOOL", `Unknown tool: ${name}`);

				try {
					const result = await tool.handler(input);
					return jsonResponse({ ok: true, result: result ?? null });
				} catch (error) {
					return errorResponse(
						400,
						"INVALID_ARGUMENT",
						error instanceof Error ? error.message : String(error),
					);
				}
			} catch (error) {
				return errorResponse(
					500,
					"INTERNAL_ERROR",
					error instanceof Error ? error.message : String(error),
				);
			}
		},
	};
}
