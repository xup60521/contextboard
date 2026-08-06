import { describe, expect, test } from "vitest";
import type { AgentCredentials } from "./credentials";
import {
	DEFAULT_SYNC_URL,
	resolveLoginServer,
	runDeviceLogin,
	shouldOpenBrowser,
} from "./device-login";

const SERVER = "https://board.example.com";

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});

const deviceCode = (overrides: Record<string, unknown> = {}) => ({
	deviceCode: "cbdc_abc",
	userCode: "BCDF-GHJK",
	verificationUriComplete: `${SERVER}/device?user_code=BCDF-GHJK`,
	expiresIn: 600,
	interval: 5,
	...overrides,
});

/**
 * Drives `runDeviceLogin` against a scripted queue of token responses with a
 * clock that only advances when the code under test sleeps, so an interval bug
 * shows up as a wrong elapsed time rather than a slow test.
 */
function harness(
	tokenResponses: Response[],
	options: { codeResponse?: Response } = {},
) {
	const requests: { url: string; body: unknown }[] = [];
	const sleeps: number[] = [];
	const logs: string[] = [];
	const warnings: string[] = [];
	const written: AgentCredentials[] = [];
	let clock = 0;
	let index = 0;

	const run = (extra: Record<string, unknown> = {}) =>
		runDeviceLogin({
			serverUrl: SERVER,
			deviceName: "test-box",
			openBrowser: false,
			env: {},
			isTty: false,
			now: () => clock,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
				clock += milliseconds;
			},
			log: (message) => logs.push(message),
			warn: (message) => warnings.push(message),
			open: () => false,
			writeCredentials: async (credentials) => {
				written.push(credentials);
				return "/home/me/.contextboard/credentials.json";
			},
			probeWorkspace: async () => "workspace-1",
			fetch: (async (url: string, init: RequestInit) => {
				requests.push({
					url,
					body: JSON.parse(String(init.body)) as unknown,
				});
				if (url.endsWith("/code"))
					return options.codeResponse ?? json(deviceCode(), { status: 201 });
				const response = tokenResponses[index++];
				if (!response) throw new Error("Unexpected extra token poll");
				return response;
			}) as unknown as typeof globalThis.fetch,
			...extra,
		});

	return { run, requests, sleeps, logs, warnings, written };
}

describe("device login", () => {
	test("polls through a pending response and saves the issued token", async () => {
		const { run, requests, written, logs } = harness([
			json({ error: "authorization_pending" }, { status: 400 }),
			json({
				token: "cbat_issued",
				tokenId: "token-1",
				name: "test-box",
				serverUrl: "https://public.example.com/",
			}),
		]);

		const credentials = await run();

		expect(credentials).toEqual({
			token: "cbat_issued",
			// The server's own public origin wins over the requested --server.
			serverUrl: "https://public.example.com",
			tokenId: "token-1",
		});
		expect(written).toEqual([credentials]);
		expect(requests[0]?.url).toBe(`${SERVER}/api/sync/v1/device/code`);
		expect(requests[0]?.body).toEqual({
			clientName: "contextboard-cli",
			deviceName: "test-box",
		});
		expect(requests[1]?.body).toEqual({ deviceCode: "cbdc_abc" });
		expect(logs.join("\n")).toContain("BCDF-GHJK");
		expect(logs.join("\n")).toContain("workspace-1");
	});

	test("omits tokenId when the server does not return one", async () => {
		const { run, written } = harness([json({ token: "cbat_issued" })]);
		await run();
		expect(written[0]).toEqual({ token: "cbat_issued", serverUrl: SERVER });
	});

	test("backs off using the larger of the returned interval and Retry-After", async () => {
		const { run, sleeps } = harness([
			json(
				{ error: "slow_down", interval: 8 },
				{ status: 429, headers: { "retry-after": "17" } },
			),
			json({ error: "slow_down", interval: 30 }, { status: 429 }),
			json({ token: "cbat_issued" }),
		]);

		await run();

		// 5s from the code response, then max(5+5, 8, 17), then max(17+5, 30).
		expect(sleeps).toEqual([5_000, 17_000, 30_000]);
	});

	test("reports denial and expiry distinctly", async () => {
		await expect(
			harness([json({ error: "access_denied" }, { status: 400 })]).run(),
		).rejects.toThrow("The user denied this device login");
		await expect(
			harness([json({ error: "expired_token" }, { status: 400 })]).run(),
		).rejects.toThrow("Device login expired");
	});

	test("surfaces an unrecognised error description", async () => {
		await expect(
			harness([
				json(
					{
						error: "invalid_request",
						error_description: "deviceCode is required",
					},
					{ status: 400 },
				),
			]).run(),
		).rejects.toThrow("deviceCode is required");
	});

	test("fails the request when the code endpoint rejects it", async () => {
		await expect(
			harness([], {
				codeResponse: json(
					{ error_description: "Poll less frequently" },
					{ status: 429 },
				),
			}).run(),
		).rejects.toThrow("Poll less frequently");
	});

	test("stops at the expiry deadline instead of polling forever", async () => {
		const pending = () =>
			json({ error: "authorization_pending" }, { status: 400 });
		const { run, sleeps } = harness([pending(), pending(), pending()], {
			codeResponse: json(deviceCode({ expiresIn: 12, interval: 5 }), {
				status: 201,
			}),
		});

		await expect(run()).rejects.toThrow("Device login expired before approval");
		// 5s, 5s, then only the 2s left before the deadline.
		expect(sleeps).toEqual([5_000, 5_000, 2_000]);
	});

	test("keeps the token when the post-login probe fails, and warns", async () => {
		const { run, warnings, written } = harness([
			json({ token: "cbat_issued" }),
		]);

		const credentials = await run({
			probeWorkspace: async () => {
				throw new Error("Forbidden");
			},
		});

		expect(credentials.token).toBe("cbat_issued");
		expect(written).toHaveLength(1);
		expect(warnings[0]).toContain("Forbidden");
	});
});

describe("login server resolution", () => {
	const never = () => Promise.resolve(null);

	test("prefers an explicit server and normalizes it to an origin", async () => {
		expect(
			await resolveLoginServer("https://board.example.com/path?x=1", {
				env: { CONTEXTBOARD_SYNC_URL: "https://env.example.com" },
				loadCredentials: never,
			}),
		).toBe(SERVER);
	});

	test("falls back to the environment, then to saved credentials", async () => {
		expect(
			await resolveLoginServer(undefined, {
				env: { CONTEXTBOARD_SYNC_URL: " https://env.example.com " },
				loadCredentials: never,
			}),
		).toBe("https://env.example.com");
		expect(
			await resolveLoginServer(undefined, {
				env: {},
				loadCredentials: async () => ({
					token: "cbat_x",
					serverUrl: "https://saved.example.com",
				}),
			}),
		).toBe("https://saved.example.com");
	});

	test("falls through to the deployed default so login needs no arguments", async () => {
		expect(
			await resolveLoginServer(undefined, { env: {}, loadCredentials: never }),
		).toBe(DEFAULT_SYNC_URL);
	});

	test("rejects a server URL that is not http or https", async () => {
		await expect(
			resolveLoginServer("ftp://board.example.com", {
				env: {},
				loadCredentials: never,
			}),
		).rejects.toThrow("http or https");
	});
});

describe("browser opt-outs", () => {
	test("opens only on an interactive terminal", () => {
		expect(shouldOpenBrowser({ env: {}, isTty: true })).toBe(true);
		expect(shouldOpenBrowser({ env: {}, isTty: false })).toBe(false);
	});

	test("stays out of the way over SSH or when disabled", () => {
		expect(
			shouldOpenBrowser({
				env: { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" },
				isTty: true,
			}),
		).toBe(false);
		expect(
			shouldOpenBrowser({ env: { CONTEXTBOARD_NO_BROWSER: "1" }, isTty: true }),
		).toBe(false);
	});
});
