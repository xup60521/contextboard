// @vitest-environment jsdom

import type { ToolDefinition, ToolServices } from "@contextboard/agent-tools";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

type FakeRequest = {
	id: number;
	tool: string;
	input: Record<string, unknown>;
};

let latestChannel: { onmessage: (request: FakeRequest) => void } | null = null;

class FakeChannel<T> {
	onmessage: (request: T) => void = () => undefined;

	constructor() {
		latestChannel = this as unknown as typeof latestChannel;
	}
}

vi.mock("@tauri-apps/api/core", () => ({ Channel: FakeChannel }));

const invoke = vi.fn(async (command: string) => {
	if (command === "desktop_bridge_status") return { enabled: true };
	if (command === "desktop_agent_subscribe") return 42;
	return null;
});

vi.mock("./DesktopRuntimeProvider", () => ({
	useDesktopInvoke: () => invoke,
}));

const { DesktopAgentBridge, dispatchAgentRequest } = await import(
	"./DesktopAgentBridge"
);

const services = {
	cards: {},
	whiteboards: {},
	canvas: {},
	relations: {},
} as ToolServices;

afterEach(() => {
	cleanup();
	latestChannel = null;
	invoke.mockClear();
});

describe("desktop agent dispatch", () => {
	test("reports an unknown tool", async () => {
		const respond = vi.fn();
		dispatchAgentRequest(
			{ id: 1, tool: "missing", input: {} },
			new Map(),
			7,
			respond,
		);
		await waitFor(() =>
			expect(respond).toHaveBeenCalledWith(7, 1, false, null, {
				code: "UNKNOWN_TOOL",
				message: "Unknown tool: missing",
			}),
		);
	});

	test("serializes a throwing handler as INVALID_ARGUMENT", async () => {
		const respond = vi.fn();
		const tool = {
			name: "fails",
			description: "fails",
			inputSchema: { type: "object" },
			handler: async () => {
				throw new Error("bad input");
			},
		} satisfies ToolDefinition;
		dispatchAgentRequest(
			{ id: 2, tool: "fails", input: {} },
			new Map([[tool.name, tool]]),
			7,
			respond,
		);
		await waitFor(() =>
			expect(respond).toHaveBeenCalledWith(7, 2, false, null, {
				code: "INVALID_ARGUMENT",
				message: "bad input",
			}),
		);
	});

	test("lets overlapping handlers resolve independently", async () => {
		const respond = vi.fn();
		const tool = {
			name: "work",
			description: "work",
			inputSchema: { type: "object" },
			handler: async (input: Record<string, unknown>) => input.value,
		} satisfies ToolDefinition;
		const byName = new Map([[tool.name, tool]]);
		dispatchAgentRequest(
			{ id: 3, tool: "work", input: { value: "a" } },
			byName,
			7,
			respond,
		);
		dispatchAgentRequest(
			{ id: 4, tool: "work", input: { value: "b" } },
			byName,
			7,
			respond,
		);
		await waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
		expect(respond).toHaveBeenCalledWith(7, 3, true, "a", null);
		expect(respond).toHaveBeenCalledWith(7, 4, true, "b", null);
	});
});

describe("desktop agent subscription", () => {
	test("unsubscribes with the generation returned by native subscribe", async () => {
		render(<DesktopAgentBridge {...services} />);
		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith(
				"desktop_agent_subscribe",
				expect.objectContaining({ tools: expect.any(Array) }),
			),
		);
		cleanup();
		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith("desktop_agent_unsubscribe", {
				generation: 42,
			}),
		);
	});
});
