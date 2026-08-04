import { afterEach, describe, expect, test } from "bun:test";
import {
	DEVICE_PATH,
	cleanupFixtures,
	createFixture,
	issueToken,
	syncHeaders,
} from "./integration-fixture";

afterEach(cleanupFixtures);

const json = (value: unknown) => JSON.stringify(value);
type FixtureApp = Awaited<ReturnType<typeof createFixture>>["app"];
const postJson = async (
	app: FixtureApp,
	path: string,
	body: unknown,
	headers: HeadersInit = {},
) =>
	await app.request(path, {
		method: "POST",
		headers: new Headers({ "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) }),
		body: json(body),
	});

describe("device authorization flow", () => {
	test("approves a code, mints a normal token, and authenticates workspaces", async () => {
		const fixture = await createFixture();
		const codeResponse = await postJson(fixture.app, `${DEVICE_PATH}/code`, {
			clientName: "contextboard-cli",
			deviceName: "test-box",
		}, { host: "attacker.example.test" });
		expect(codeResponse.status).toBe(201);
		const code = (await codeResponse.json()) as {
			deviceCode: string;
			userCode: string;
			verificationUri: string;
			verificationUriComplete: string;
			interval: number;
		};
		expect(code.verificationUri).toBe("https://board.example.test/device");
		expect(code.verificationUriComplete).toContain("user_code=");

		const metadata = await fixture.app.request(
			`${DEVICE_PATH}/authorization?user_code=${encodeURIComponent(code.userCode)}`,
			{ headers: fixture.browserHeaders },
		);
		expect(metadata.status).toBe(200);
		expect(await metadata.json()).toMatchObject({
			userCode: code.userCode,
			clientName: "contextboard-cli",
			deviceName: "test-box",
			status: "pending",
		});

		const approved = await postJson(
			fixture.app,
			`${DEVICE_PATH}/authorization`,
			{ userCode: code.userCode, action: "approve" },
			fixture.browserHeaders,
		);
		expect(approved.status).toBe(204);

		const tokenResponse = await postJson(
			fixture.app,
			`${DEVICE_PATH}/token`,
			{ deviceCode: code.deviceCode },
		);
		expect(tokenResponse.status).toBe(200);
		const token = (await tokenResponse.json()) as {
			token: string;
			tokenId: string;
			name: string;
			serverUrl: string;
		};
		expect(token.token).toStartWith("cbat_");
		expect(token.name).toBe("contextboard-cli (test-box)");
		expect(token.serverUrl).toBe("https://board.example.test");
		expect(token.tokenId).toBeString();

		const workspaces = await fixture.app.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: `Bearer ${token.token}` }),
		});
		expect(workspaces.status).toBe(200);
	});

	test("denial and replay use the RFC error names", async () => {
		const fixture = await createFixture();
		const deniedCode = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {})
		).json()) as { deviceCode: string; userCode: string };
		await postJson(
			fixture.app,
			`${DEVICE_PATH}/authorization`,
			{ userCode: deniedCode.userCode, action: "deny" },
			fixture.browserHeaders,
		);
		const denied = await postJson(fixture.app, `${DEVICE_PATH}/token`, {
			deviceCode: deniedCode.deviceCode,
		});
		expect(denied.status).toBe(400);
		expect(await denied.json()).toMatchObject({ error: "access_denied" });

		const approvedCode = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {})
		).json()) as { deviceCode: string; userCode: string };
		await postJson(
			fixture.app,
			`${DEVICE_PATH}/authorization`,
			{ userCode: approvedCode.userCode, action: "approve" },
			fixture.browserHeaders,
		);
		const first = await postJson(fixture.app, `${DEVICE_PATH}/token`, {
			deviceCode: approvedCode.deviceCode,
		});
		expect(first.status).toBe(200);
		const replay = await postJson(fixture.app, `${DEVICE_PATH}/token`, {
			deviceCode: approvedCode.deviceCode,
		});
		const unknown = await postJson(fixture.app, `${DEVICE_PATH}/token`, {
			deviceCode: "cbdc_unknown-device-code",
		});
		expect(replay.status).toBe(400);
		expect(unknown.status).toBe(400);
		expect(await replay.json()).toEqual(await unknown.json());
	});

	test("slow_down returns the new interval and Retry-After", async () => {
		const fixture = await createFixture();
		const code = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {})
		).json()) as { deviceCode: string };
		const first = await postJson(fixture.app, `${DEVICE_PATH}/token`, code);
		expect(first.status).toBe(400);
		const second = await postJson(fixture.app, `${DEVICE_PATH}/token`, code);
		expect(second.status).toBe(429);
		expect(second.headers.get("retry-after")).toBe("10");
		expect(await second.json()).toMatchObject({
			error: "slow_down",
			interval: 10,
		});
	});

	test("all device endpoints ignore missing and incorrect sync versions", async () => {
		const fixture = await createFixture();
		const wrongVersion = { "x-contextboard-protocol-version": "999" };
		const noHeaderCode = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {}, {})
		).json()) as { deviceCode: string; userCode: string };
		const wrongHeaderCode = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {}, wrongVersion)
		).json()) as { deviceCode: string; userCode: string };

		for (const [userCode, headers] of [
			[noHeaderCode.userCode, fixture.browserHeaders],
			[
				wrongHeaderCode.userCode,
				new Headers({
					...Object.fromEntries(fixture.browserHeaders),
					...wrongVersion,
				}),
			],
		] as const) {
			const response = await fixture.app.request(
			`${DEVICE_PATH}/authorization?user_code=${encodeURIComponent(userCode)}`,
			{ headers },
			);
			expect(response.status).toBe(200);
		}

		for (const [userCode, headers] of [
			[noHeaderCode.userCode, fixture.browserHeaders],
			[
				wrongHeaderCode.userCode,
				new Headers({
					...Object.fromEntries(fixture.browserHeaders),
					...wrongVersion,
				}),
			],
		] as const) {
			const response = await postJson(
				fixture.app,
				`${DEVICE_PATH}/authorization`,
				{ userCode, action: "approve" },
				headers,
			);
			expect(response.status).toBe(204);
		}

		const noHeaderToken = await postJson(
			fixture.app,
			`${DEVICE_PATH}/token`,
			{ deviceCode: noHeaderCode.deviceCode },
			{},
		);
		expect(noHeaderToken.status).toBe(200);
		const wrongHeaderToken = await postJson(
			fixture.app,
			`${DEVICE_PATH}/token`,
			{ deviceCode: wrongHeaderCode.deviceCode },
			wrongVersion,
		);
		expect(wrongHeaderToken.status).toBe(200);
	});

	test("browser endpoints reject anonymous and agent-token callers", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const code = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {})
		).json()) as { userCode: string };
		const anonymous = await fixture.app.request(
			`${DEVICE_PATH}/authorization?user_code=${code.userCode}`,
		);
		expect(anonymous.status).toBe(401);
		const agentHeaders = { authorization: `Bearer ${created.token}` };
		const agent = await fixture.app.request(
			`${DEVICE_PATH}/authorization?user_code=${code.userCode}`,
			{ headers: agentHeaders },
		);
		expect(agent.status).toBe(403);
		const agentApprove = await postJson(
			fixture.app,
			`${DEVICE_PATH}/authorization`,
			{ userCode: code.userCode, action: "approve" },
			agentHeaders,
		);
		expect(agentApprove.status).toBe(403);
	});

	test("the allowlist is enforced and approval belongs to the approving user", async () => {
		const fixture = await createFixture("owner@example.com");
		const blockedCode = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {})
		).json()) as { userCode: string };
		const blocked = await fixture.appFor("other@example.com").request(
			`${DEVICE_PATH}/authorization?user_code=${blockedCode.userCode}`,
			{ headers: fixture.browserHeaders },
		);
		expect(blocked.status).toBe(403);

		const requested = (await (
			await postJson(fixture.app, `${DEVICE_PATH}/code`, {
				deviceName: "requesting-box",
			})
		).json()) as { deviceCode: string; userCode: string };
		const approver = await fixture.createBrowserSession("other@example.com");
		const bothUsers = fixture.appFor("owner@example.com,other@example.com");
		const approved = await postJson(
			bothUsers,
			`${DEVICE_PATH}/authorization`,
			{ userCode: requested.userCode, action: "approve" },
			approver.browserHeaders,
		);
		expect(approved.status).toBe(204);
		const tokenResponse = await postJson(bothUsers, `${DEVICE_PATH}/token`, {
			deviceCode: requested.deviceCode,
		});
		const token = (await tokenResponse.json()) as { token: string };
		expect(
			fixture.store.listAgentTokens(fixture.user.id),
		).toHaveLength(0);
		expect(fixture.store.listAgentTokens(approver.user.id)[0]?.name).toBe(
			"contextboard-cli (requesting-box)",
		);
		expect(
			(await bothUsers.request("/api/sync/v1/workspaces", {
				headers: syncHeaders({ authorization: `Bearer ${token.token}` }),
			})).status,
		).toBe(200);
	});
});
