import { afterEach, describe, expect, test } from "bun:test";
import {
	AGENT_TOKENS_PATH,
	cleanupFixtures,
	createFixture,
	issueToken,
	syncHeaders,
} from "./integration-fixture";

afterEach(cleanupFixtures);

describe("agent tokens end to end", () => {
	test("a browser session can issue a token, and it authenticates sync requests", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		expect(created.token).toStartWith("cbat_");

		const response = await fixture.app.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: `Bearer ${created.token}` }),
		});
		expect(response.status).toBe(200);
	});

	test("token management does not require sync protocol version headers", async () => {
		const fixture = await createFixture();
		const response = await fixture.app.request(AGENT_TOKENS_PATH, {
			headers: fixture.browserHeaders,
		});
		expect(response.status).toBe(200);
	});

	test("the plaintext token is returned once and never listed again", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const listed = await fixture.app.request(AGENT_TOKENS_PATH, {
			headers: fixture.browserHeaders,
		});
		const body = await listed.text();
		expect(body).not.toContain(created.token);
		expect(JSON.parse(body)).toHaveLength(1);
	});

	test("an agent token cannot mint or revoke agent tokens", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const agentHeaders = { authorization: `Bearer ${created.token}` };

		const minted = await fixture.app.request(AGENT_TOKENS_PATH, {
			method: "POST",
			headers: new Headers({
				...agentHeaders,
				"content-type": "application/json",
			}),
			body: JSON.stringify({ name: "escalated" }),
		});
		expect(minted.status).toBe(403);

		const revoked = await fixture.app.request(
			`${AGENT_TOKENS_PATH}/${created.id}`,
			{
				method: "DELETE",
				headers: new Headers(agentHeaders),
			},
		);
		expect(revoked.status).toBe(403);

		const listed = await fixture.app.request(AGENT_TOKENS_PATH, {
			headers: new Headers(agentHeaders),
		});
		expect(listed.status).toBe(403);
	});

	test("a revoked token stops working immediately", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const headers = syncHeaders({ authorization: `Bearer ${created.token}` });
		expect(
			(await fixture.app.request("/api/sync/v1/workspaces", { headers })).status,
		).toBe(200);

		const revoked = await fixture.app.request(
			`${AGENT_TOKENS_PATH}/${created.id}`,
			{ method: "DELETE", headers: fixture.browserHeaders },
		);
		expect(revoked.status).toBe(204);

		const after = await fixture.app.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: `Bearer ${created.token}` }),
		});
		expect(after.status).toBe(401);
	});

	test("removing the owner from the allowlist disables their tokens", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const narrowed = fixture.appFor("someone-else@example.com");
		const response = await narrowed.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: `Bearer ${created.token}` }),
		});
		expect(response.status).toBe(403);
	});

	test("unknown tokens are rejected and reveal nothing", async () => {
		const fixture = await createFixture();
		const response = await fixture.app.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: "Bearer cbat_not-a-real-token" }),
		});
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
	});

	test("rejects a blank token name", async () => {
		const fixture = await createFixture();
		const response = await fixture.app.request(AGENT_TOKENS_PATH, {
			method: "POST",
			headers: new Headers({
				...Object.fromEntries(fixture.browserHeaders),
				"content-type": "application/json",
			}),
			body: JSON.stringify({ name: "   " }),
		});
		expect(response.status).toBe(400);
	});

	test("records usage when a token is exercised", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		await fixture.app.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: `Bearer ${created.token}` }),
		});
		const listed = (await (
			await fixture.app.request(AGENT_TOKENS_PATH, {
				headers: fixture.browserHeaders,
			})
		).json()) as Array<{ lastUsedAt: number | null }>;
		expect(listed[0]?.lastUsedAt).toBeNumber();
	});
});
