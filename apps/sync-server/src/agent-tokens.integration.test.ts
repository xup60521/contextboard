import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AuthConfiguration,
	createContextboardAuth,
	migrateContextboardAuth,
} from "@contextboard/auth";
import { syncVersionHeaders } from "@contextboard/sync-protocol";
import { serializeSignedCookie } from "better-call";
import { parseAllowedEmails } from "./access";
import { createSyncApp } from "./app";
import { SyncStore } from "./store";

const AGENT_TOKENS = "/api/sync/v1/agent-tokens";
const roots: string[] = [];
const databases: Database[] = [];
const stores: SyncStore[] = [];
const secret = "contextboard-auth-test-secret-at-least-32-bytes";

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const database of databases.splice(0)) database.close();
	for (const root of roots.splice(0)) {
		try {
			rmSync(root, { recursive: true, force: true });
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "EBUSY"
			)
				throw error;
		}
	}
});

function createAuthConfiguration(root: string): AuthConfiguration {
	return {
		databasePath: join(root, "auth.sqlite"),
		baseURL: "http://localhost:3000",
		trustedOrigins: ["http://localhost:3000"],
		secret,
		githubClientId: "test-client",
		githubClientSecret: "test-secret",
	};
}

async function createFixture(email = "owner@example.com") {
	const root = mkdtempSync(join(tmpdir(), "contextboard-agent-int-"));
	roots.push(root);
	const auth = createContextboardAuth(createAuthConfiguration(root));
	databases.push(auth.options.database as Database);
	await migrateContextboardAuth(auth);
	const context = await auth.$context;
	const user = await context.internalAdapter.createUser({
		id: crypto.randomUUID(),
		name: "Test User",
		email,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const session = await context.internalAdapter.createSession(user.id);
	const cookie = await serializeSignedCookie(
		context.authCookies.sessionToken.name,
		session.token,
		secret,
	);
	const store = new SyncStore(":memory:", join(root, "blobs"));
	stores.push(store);
	const appFor = (allowed: string) =>
		createSyncApp(store, auth, { allowedEmails: parseAllowedEmails(allowed) });
	return {
		app: appFor(email),
		appFor,
		store,
		browserHeaders: new Headers({ cookie }),
	};
}

const syncHeaders = (headers: HeadersInit = {}) =>
	new Headers({
		...syncVersionHeaders(),
		...Object.fromEntries(new Headers(headers)),
	});

async function issueToken(
	fixture: Awaited<ReturnType<typeof createFixture>>,
	name = "remote box",
) {
	const response = await fixture.app.request(AGENT_TOKENS, {
		method: "POST",
		headers: new Headers({
			...Object.fromEntries(fixture.browserHeaders),
			"content-type": "application/json",
		}),
		body: JSON.stringify({ name }),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string; token: string };
}

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
		// Deliberately no version headers: a protocol bump must not prevent a user
		// from revoking a credential.
		const fixture = await createFixture();
		const response = await fixture.app.request(AGENT_TOKENS, {
			headers: fixture.browserHeaders,
		});
		expect(response.status).toBe(200);
	});

	test("the plaintext token is returned once and never listed again", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const listed = await fixture.app.request(AGENT_TOKENS, {
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

		const minted = await fixture.app.request(AGENT_TOKENS, {
			method: "POST",
			headers: new Headers({
				...agentHeaders,
				"content-type": "application/json",
			}),
			body: JSON.stringify({ name: "escalated" }),
		});
		expect(minted.status).toBe(403);

		const revoked = await fixture.app.request(`${AGENT_TOKENS}/${created.id}`, {
			method: "DELETE",
			headers: new Headers(agentHeaders),
		});
		expect(revoked.status).toBe(403);

		const listed = await fixture.app.request(AGENT_TOKENS, {
			headers: new Headers(agentHeaders),
		});
		expect(listed.status).toBe(403);
	});

	test("a revoked token stops working immediately", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		const headers = syncHeaders({ authorization: `Bearer ${created.token}` });
		expect(
			(await fixture.app.request("/api/sync/v1/workspaces", { headers }))
				.status,
		).toBe(200);

		const revoked = await fixture.app.request(`${AGENT_TOKENS}/${created.id}`, {
			method: "DELETE",
			headers: fixture.browserHeaders,
		});
		expect(revoked.status).toBe(204);

		const after = await fixture.app.request("/api/sync/v1/workspaces", {
			headers: syncHeaders({ authorization: `Bearer ${created.token}` }),
		});
		expect(after.status).toBe(401);
	});

	test("removing the owner from the allowlist disables their tokens", async () => {
		const fixture = await createFixture();
		const created = await issueToken(fixture);
		// Same store and auth, but the operator has since narrowed the allowlist.
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
		const response = await fixture.app.request(AGENT_TOKENS, {
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
			await fixture.app.request(AGENT_TOKENS, {
				headers: fixture.browserHeaders,
			})
		).json()) as Array<{ lastUsedAt: number | null }>;
		expect(listed[0]?.lastUsedAt).toBeNumber();
	});
});
