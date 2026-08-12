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
		const upstream = bindingFetch.mock.calls[0]?.[0] as Request;
		expect(new URL(upstream.url).protocol).toBe("http:");
		expect(upstream.url).toBe("http://localhost:8788/api/sync/v1/pull");
	});

	test("returns 503 instead of guessing a production origin", async () => {
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/health", {
				headers: { origin: "http://tauri.localhost" },
			}),
			{} as WorkerEnv,
		);
		expect(response.status).toBe(503);
		expect(response.headers.get("retry-after")).toBe("5");
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"http://tauri.localhost",
		);
		expect(response.headers.get("vary")).toContain("Origin");
	});

	test("strips spoofable forwarding headers", async () => {
		const directFetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", directFetch);
		await proxyPrivateApi(
			new Request("http://localhost/api/auth/get-session", {
				headers: {
					authorization: "Bearer secret",
					cookie: "session=secret",
					"x-forwarded-for": "spoofed",
					"x-private-header": "nope",
					host: "spoofed",
				},
			}),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		const forwarded = directFetch.mock.calls[0]?.[0] as Request;
		expect(forwarded.headers.has("x-forwarded-for")).toBe(false);
		expect(forwarded.headers.has("x-private-header")).toBe(false);
		expect(forwarded.headers.get("authorization")).toBe("Bearer secret");
		expect(forwarded.headers.get("cookie")).toBe("session=secret");
		expect(forwarded.headers.get("x-contextboard-gateway")).toBe(
			"cloudflare-worker",
		);
	});

	test("buffers bounded JSON but keeps blob uploads streaming", async () => {
		const directFetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", directFetch);
		await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/push", {
				method: "POST",
				body: "{}",
			}),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		const jsonRequest = directFetch.mock.calls[0]?.[0] as Request;
		expect(jsonRequest.headers.get("content-length")).toBe("2");
		expect(await jsonRequest.text()).toBe("{}");

		const source = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("blob"));
				controller.close();
			},
		});
		await proxyPrivateApi(
			new Request(`http://localhost/api/sync/v1/blobs/${"a".repeat(64)}`, {
				method: "PUT",
				body: source,
				duplex: "half",
				headers: {
					"x-contextboard-blob-size": "4",
					"x-contextboard-workspace": "workspace_1",
				},
			} as RequestInit & { duplex: "half" }),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		const blobRequest = directFetch.mock.calls[1]?.[0] as Request;
		expect(blobRequest.body).not.toBeNull();
		expect(await blobRequest.text()).toBe("blob");
	});

	test("enforces both declared and actual body limits", async () => {
		const directFetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", directFetch);
		const declared = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/push", {
				method: "POST",
				headers: {
					"content-length": String(2 * 1024 * 1024 + 1),
					origin: "tauri://localhost",
				},
				body: "{}",
			}),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		expect(declared.status).toBe(413);
		expect(declared.headers.get("access-control-allow-origin")).toBe(
			"tauri://localhost",
		);

		const actual = await proxyPrivateApi(
			new Request("http://localhost/api/auth/sign-in/email", {
				method: "POST",
				body: new Uint8Array(2 * 1024 * 1024 + 1),
			}),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		expect(actual.status).toBe(413);
		expect(directFetch).not.toHaveBeenCalled();
	});

	test("uses separate rate limits without exposing credentials", async () => {
		const directFetch = vi.fn(async () => new Response(null, { status: 204 }));
		const syncLimit = vi.fn(async () => ({ success: false }));
		vi.stubGlobal("fetch", directFetch);
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/pull", {
				method: "POST",
				body: "{}",
				headers: { authorization: "Bearer do-not-log" },
			}),
			{
				SYNC_VPS_URL: "http://127.0.0.1:8788",
				SYNC_RATE_LIMIT: { limit: syncLimit } as unknown as RateLimit,
			},
		);
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
		const key = syncLimit.mock.calls[0]?.[0].key;
		expect(key).toMatch(/^credential:[a-f0-9]{64}$/);
		expect(key).not.toContain("do-not-log");
		expect(directFetch).not.toHaveBeenCalled();
	});

	test("uses the device limiter and anonymous IP keys for device flow", async () => {
		const directFetch = vi.fn(async () => Response.json({ ok: true }));
		const deviceLimit = vi.fn(async () => ({ success: false }));
		const syncLimit = vi.fn(async () => ({ success: true }));
		vi.stubGlobal("fetch", directFetch);
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/sync/v1/device/token", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: "session=secret",
					authorization: "Bearer secret",
					"cf-connecting-ip": "203.0.113.9",
				},
				body: JSON.stringify({ deviceCode: "cbdc_test" }),
			}),
			{
				SYNC_VPS_URL: "http://127.0.0.1:8788",
				SYNC_RATE_LIMIT: { limit: syncLimit } as unknown as RateLimit,
				DEVICE_RATE_LIMIT: { limit: deviceLimit } as unknown as RateLimit,
			},
		);
		expect(response.status).toBe(429);
		expect(deviceLimit).toHaveBeenCalledOnce();
		expect(syncLimit).not.toHaveBeenCalled();
		expect(deviceLimit.mock.calls[0]?.[0].key).toBe(
			"anonymous:203.0.113.9",
		);
		expect(directFetch).not.toHaveBeenCalled();
	});

	test("passes an abortable timeout signal and redacts failure logs", async () => {
		const directFetch = vi.fn(async (request: Request) => {
			expect(request.signal).toBeInstanceOf(AbortSignal);
			throw new Error(
				"http://private-vps.internal cookie=session authorization=Bearer-secret",
			);
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		vi.stubGlobal("fetch", directFetch);
		const response = await proxyPrivateApi(
			new Request("http://localhost/api/auth/get-session", {
				headers: {
					authorization: "Bearer-secret",
					cookie: "session=secret",
				},
			}),
			{ SYNC_VPS_URL: "http://127.0.0.1:8788" },
		);
		expect(response.status).toBe(503);
		const log = String(consoleError.mock.calls[0]?.[0]);
		expect(log).toContain('"event":"private_service_unavailable"');
		expect(log).not.toContain("private-vps");
		expect(log).not.toContain("Bearer-secret");
		expect(log).not.toContain("session=secret");
	});
});
