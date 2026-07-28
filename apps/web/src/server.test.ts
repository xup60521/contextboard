import { afterEach, describe, expect, test, vi } from "vitest";
import { proxyPrivateApi, type WorkerEnv } from "./server";

afterEach(() => vi.unstubAllGlobals());

describe("private API gateway", () => {
	test("prefers the explicit development URL over a VPC binding", async () => {
		const directFetch = vi.fn(async () => Response.json({ source: "direct" }));
		const bindingFetch = vi.fn(async () => Response.json({ source: "vpc" }));
		vi.stubGlobal("fetch", directFetch);
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/health"),
			{
				SYNC_VPS_URL: "http://127.0.0.1:8788/",
				SYNC_VPS: { fetch: bindingFetch } as unknown as Fetcher,
			},
		);
		expect(await response.json()).toEqual({ source: "direct" });
		expect(directFetch).toHaveBeenCalledOnce();
		expect(bindingFetch).not.toHaveBeenCalled();
		expect((directFetch.mock.calls[0]?.[0] as Request).url).toBe(
			"http://127.0.0.1:8788/api/sync/v1/health",
		);
	});

	test("uses the VPC binding when no development URL is configured", async () => {
		const bindingFetch = vi.fn(async () => Response.json({ source: "vpc" }));
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/pull", {
				method: "POST",
				body: "{}",
			}),
			{ SYNC_VPS: { fetch: bindingFetch } as unknown as Fetcher },
		);
		expect(await response.json()).toEqual({ source: "vpc" });
		expect(bindingFetch).toHaveBeenCalledOnce();
	});

	test("returns 503 instead of guessing a production origin", async () => {
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/health"),
			{} as WorkerEnv,
		);
		expect(response.status).toBe(503);
		expect(response.headers.get("retry-after")).toBe("5");
	});

	test("strips spoofable forwarding headers", async () => {
		const directFetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", directFetch);
		await proxyPrivateApi(
			new Request("http://localhost/api/auth/get-session", {
				headers: { "x-forwarded-for": "spoofed", host: "spoofed" },
			}),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		const forwarded = directFetch.mock.calls[0]?.[0] as Request;
		expect(forwarded.headers.has("x-forwarded-for")).toBe(false);
		expect(forwarded.headers.get("x-contextboard-gateway")).toBe(
			"cloudflare-worker",
		);
	});
});
