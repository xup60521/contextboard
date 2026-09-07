import { afterEach, describe, expect, test } from "bun:test";
import {
	cleanupFixtures,
	createFixture as createSyncFixture,
	syncHeaders,
} from "./integration-fixture";

afterEach(cleanupFixtures);

async function createFixture(options: {
	email: string;
	emailVerified?: boolean;
}) {
	const fixture = await createSyncFixture(
		options.email,
		options.emailVerified,
	);
	return {
		app: fixture.appFor("owner@example.com"),
		auth: fixture.auth,
		headers: fixture.browserHeaders,
	};
}

describe("email allowlist integration", () => {
	test("allows verified users and rejects unallowlisted or unverified users", async () => {
		const allowed = await createFixture({ email: "OWNER@example.com" });
		const allowedResponse = await allowed.app.request(
			"/api/sync/v1/workspaces",
			{ headers: syncHeaders(allowed.headers) },
		);
		expect(allowedResponse.status).toBe(200);

		const rejected = await createFixture({ email: "other@example.com" });
		const rejectedResponse = await rejected.app.request(
			"/api/sync/v1/workspaces",
			{ headers: syncHeaders(rejected.headers) },
		);
		expect(rejectedResponse.status).toBe(403);
		expect(await rejectedResponse.json()).toEqual({ error: "Forbidden" });

		const unverified = await createFixture({
			email: "owner@example.com",
			emailVerified: false,
		});
		const unverifiedResponse = await unverified.app.request(
			"/api/sync/v1/workspaces",
			{ headers: syncHeaders(unverified.headers) },
		);
		expect(unverifiedResponse.status).toBe(403);
	});

	test("keeps workspace membership checks after email authorization", async () => {
		const fixture = await createFixture({ email: "owner@example.com" });
		const response = await fixture.app.request(
			"/api/sync/v1/checkpoints/latest?workspaceId=not-a-member",
			{ headers: syncHeaders(fixture.headers) },
		);
		expect(response.status).toBe(403);
	});

	test("gates desktop session and one-time-token routes", async () => {
		const fixture = await createFixture({ email: "other@example.com" });

		const session = await fixture.app.request("/api/auth/get-session", {
			headers: fixture.headers,
		});
		expect(session.status).toBe(403);

		const generate = await fixture.app.request(
			"/api/auth/one-time-token/generate",
			{ headers: fixture.headers },
		);
		expect(generate.status).toBe(403);

		const token = await fixture.auth.api.generateOneTimeToken({
			headers: fixture.headers,
		});
		const verify = await fixture.app.request(
			"/api/auth/one-time-token/verify",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token: token.token }),
			},
		);
		expect(verify.status).toBe(403);
		expect(verify.headers.get("set-auth-token")).toBeNull();
	});

	test("allows the desktop handoff for an allowlisted user", async () => {
		const fixture = await createFixture({ email: "owner@example.com" });
		const session = await fixture.app.request("/api/auth/get-session", {
			headers: fixture.headers,
		});
		expect(session.status).toBe(200);
		expect((await session.json()).user.email).toBe("owner@example.com");

		const generated = await fixture.app.request(
			"/api/auth/one-time-token/generate",
			{ headers: fixture.headers },
		);
		expect(generated.status).toBe(200);
		const token = (await generated.json()).token;

		const verified = await fixture.app.request(
			"/api/auth/one-time-token/verify",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token }),
			},
		);
		expect(verified.status).toBe(200);
		expect(verified.headers.get("set-auth-token")).toBeTruthy();
	});
});
