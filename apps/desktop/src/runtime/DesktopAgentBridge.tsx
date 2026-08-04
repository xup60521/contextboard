import {
	createTools,
	type ToolDefinition,
	type ToolServices,
} from "@contextboard/agent-tools";
import { Channel } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useDesktopInvoke } from "./DesktopRuntimeProvider";
import { invokeDesktop } from "./repository";

export type AgentRequest = {
	id: number;
	tool: string;
	input: Record<string, unknown>;
};

export type AgentErrorBody = {
	code: string;
	message: string;
};

type Respond = (
	generation: number,
	id: number,
	ok: boolean,
	result: unknown,
	error: AgentErrorBody | null,
) => void;

export function describeAgentError(error: unknown): AgentErrorBody {
	return error instanceof Error
		? { code: "INVALID_ARGUMENT", message: error.message }
		: {
				code: "INTERNAL_ERROR",
				message: "The renderer returned an invalid tool error",
			};
}

export function unknownTool(tool: string): AgentErrorBody {
	return { code: "UNKNOWN_TOOL", message: `Unknown tool: ${tool}` };
}

/** Dispatches one request; each invocation owns its own promise chain. */
export function dispatchAgentRequest(
	request: AgentRequest,
	byName: Map<string, ToolDefinition>,
	generation: number,
	respond: Respond,
) {
	const tool = byName.get(request.tool);
	if (!tool) {
		respond(generation, request.id, false, null, unknownTool(request.tool));
		return;
	}

	void Promise.resolve()
		.then(() => tool.handler(request.input))
		.then(
			(result) => respond(generation, request.id, true, result ?? null, null),
			(error) =>
				respond(generation, request.id, false, null, describeAgentError(error)),
		);
}

type AgentServerStatus = {
	enabled: boolean;
};

type DesktopAgentBridgeProps = ToolServices;

/**
 * Side-effect-only renderer subscriber. It waits for the native listener to be
 * enabled, then gives that listener the exact service instances used by the UI.
 */
export function DesktopAgentBridge({
	cards,
	whiteboards,
	canvas,
	relations,
}: DesktopAgentBridgeProps) {
	const invoke = useDesktopInvoke();
	const [enabled, setEnabled] = useState(false);

	useEffect(() => {
		let active = true;
		const refresh = async () => {
			try {
				const status = await invokeDesktop<AgentServerStatus>(
					"desktop_bridge_status",
					{},
					invoke,
				);
				if (active) setEnabled(status?.enabled === true);
			} catch {
				if (active) setEnabled(false);
			}
		};
		void refresh();
		const timer = setInterval(() => void refresh(), 1_000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [invoke]);

	useEffect(() => {
		if (!enabled) return;

		const tools = createTools({ cards, whiteboards, canvas, relations });
		const byName = new Map(tools.map((tool) => [tool.name, tool]));
		const channel = new Channel<AgentRequest>();
		let generation: number | null = null;
		let disposed = false;
		const queued: AgentRequest[] = [];
		const respond = (
			requestGeneration: number,
			id: number,
			ok: boolean,
			result: unknown,
			error: AgentErrorBody | null,
		) => {
			void invokeDesktop(
				"desktop_agent_respond",
				{ generation: requestGeneration, id, ok, result, error },
				invoke,
			).catch(() => undefined);
		};
		const dispatch = (request: AgentRequest) => {
			if (generation === null) {
				queued.push(request);
				return;
			}
			dispatchAgentRequest(request, byName, generation, respond);
		};
		channel.onmessage = dispatch;

		const unsubscribe = (value: number) => {
			void invokeDesktop(
				"desktop_agent_unsubscribe",
				{ generation: value },
				invoke,
			).catch(() => undefined);
		};
		void invokeDesktop<number>(
			"desktop_agent_subscribe",
			{ channel, tools: tools.map((tool) => tool.name) },
			invoke,
		)
			.then((value) => {
				generation = value;
				if (disposed) {
					unsubscribe(value);
					return;
				}
				for (const request of queued.splice(0)) dispatch(request);
			})
			.catch(() => {
				queued.length = 0;
			});

		return () => {
			disposed = true;
			queued.length = 0;
			if (generation !== null) unsubscribe(generation);
		};
	}, [cards, canvas, enabled, invoke, relations, whiteboards]);

	return null;
}
