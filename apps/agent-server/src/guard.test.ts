import { describe, expect, test } from "vitest";
import { guardRequest } from "./guard";
import { createAgentHttpApp } from "./http";

const PORT = 8790;
const host = `127.0.0.1:${PORT}`;
const guarded = (path: string, init: RequestInit = {}) =>
	new Request(`http://127.0.0.1:${PORT}${path}`, {
		...init,
		headers: new Headers({ host, ...(init.headers ?? {}) }),
	});

const tool = {
	name: "echo",
	description: "Echo an input.",
	inputSchema: { type: "object" },
	handler: async (input: Record<string, unknown>) => input,
};

describe("agent-server loopback guard", () => {
	test("allows guarded POST discovery with an empty JSON body", async () => {
		const app = createAgentHttpApp([tool], {
			mode: "replica",
			workspaceId: "workspace-1",
			version: "test",
			port: PORT,
		});
		const discovery = {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		};
		const health = await app.fetch(guarded("/api/v1/_health", discovery));
		const tools = await app.fetch(guarded("/api/v1/_tools", discovery));
		expect(health.status).toBe(200);
		expect(health.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await health.json()).toMatchObject({
			ok: true,
			mode: "replica",
			port: PORT,
		});
		expect(await tools.json()).toEqual([
			{
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			},
		]);
		expect(tools.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
	});

	test("requires POST for tools and discovery", () => {
		expect(guardRequest(guarded("/api/v1/echo"), PORT)).toMatchObject({
			status: 405,
			code: "METHOD_NOT_ALLOWED",
		});
		expect(
			guardRequest(guarded("/api/v1/_health", { method: "GET" }), PORT),
		).toMatchObject({ status: 405, code: "METHOD_NOT_ALLOWED" });
	});

	test("rejects paths, browser origins, and non-JSON tool calls", () => {
		expect(guardRequest(guarded("/wrong"), PORT)).toMatchObject({
			status: 404,
			code: "NOT_FOUND",
		});
		expect(
			guardRequest(
				guarded("/api/v1/_health", {
					method: "POST",
					headers: {
						origin: "https://evil.test",
						"content-type": "application/json",
					},
					body: "{}",
				}),
				PORT,
			),
		).toMatchObject({ status: 403, code: "FORBIDDEN_ORIGIN" });
		expect(
			guardRequest(guarded("/api/v1/echo", { method: "POST" }), PORT),
		).toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
	});

	test("requires a literal loopback host and the bound port", () => {
		for (const invalidHost of [
			"127.0.0.2:8790",
			"localhost:8791",
			"agent.example.test:8790",
			"127.0.0.1",
		]) {
			const request = new Request("http://127.0.0.1:8790/api/v1/_health", {
				method: "POST",
				headers: { host: invalidHost, "content-type": "application/json" },
				body: "{}",
			});
			expect(guardRequest(request, PORT)).toMatchObject({
				status: 403,
				code: "FORBIDDEN_HOST",
			});
		}
		for (const validHost of ["localhost:8790", "[::1]:8790"]) {
			const request = new Request("http://127.0.0.1:8790/api/v1/_health", {
				method: "POST",
				headers: { host: validHost, "content-type": "application/json" },
				body: "{}",
			});
			expect(guardRequest(request, PORT)).toBeNull();
		}
	});

	test("accepts JSON parameters and maps tool failures", async () => {
		const app = createAgentHttpApp(
			[
				tool,
				{
					...tool,
					name: "fails",
					handler: async () => {
						throw new Error("bad input");
					},
				},
			],
			{
				mode: "replica",
				workspaceId: "workspace-1",
				version: "test",
				port: PORT,
			},
		);
		const response = await app.fetch(
			guarded("/api/v1/echo", {
				method: "POST",
				headers: { "content-type": "application/json; charset=utf-8" },
				body: JSON.stringify({ hello: "文化資本：身體化" }),
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await response.json()).toEqual({
			ok: true,
			result: { hello: "文化資本：身體化" },
		});

		const malformed = await app.fetch(
			guarded("/api/v1/echo", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "not-json",
			}),
		);
		expect(malformed.status).toBe(400);
		expect(malformed.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await malformed.json()).toMatchObject({
			ok: false,
			error: { code: "INVALID_ARGUMENT" },
		});

		const failed = await app.fetch(
			guarded("/api/v1/fails", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		);
		expect(failed.status).toBe(400);
		expect(failed.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await failed.json()).toMatchObject({
			ok: false,
			error: { code: "INVALID_ARGUMENT", message: "bad input" },
		});
	});
});
