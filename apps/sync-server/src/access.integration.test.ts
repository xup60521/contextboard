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

const roots: string[] = [];
const databases: Database[] = [];
const secret = "contextboard-auth-test-secret-at-least-32-bytes";

afterEach(() => {
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

async function createFixture(options: {
	email: string;
	emailVerified?: boolean;
}) {
	const root = mkdtempSync(join(tmpdir(), "contextboard-access-"));
	roots.push(root);
	const auth = createContextboardAuth(createAuthConfiguration(root));
	databases.push(auth.options.database as Database);
	await migrateContextboardAuth(auth);
	const context = await auth.$context;
	const user = await context.internalAdapter.createUser({
		id: crypto.randomUUID(),
		name: "Test User",
		email: options.email,
		emailVerified: options.emailVerified ?? true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const session = await context.internalAdapter.createSession(user.id);
	const cookie = await serializeSignedCookie(
		context.authCookies.sessionToken.name,
		session.token,
		secret,
	);
	const headers = new Headers({ cookie });
	const store = new SyncStore(":memory:", join(root, "blobs"));
	const app = createSyncApp(store, auth, {
		allowedEmails: parseAllowedEmails("owner@example.com"),
	});
	return { app, auth, headers, store };
}

function syncHeaders(headers: Headers) {
	const result = new Headers(headers);
	for (const [name, value] of Object.entries(syncVersionHeaders()))
		result.set(name, value);
	return result;
}

describe("email allowlist integration", () => {
	test("allows verified users and rejects unallowlisted or unverified users", async () => {
		const allowed = await createFixture({ email: "OWNER@example.com" });
		const allowedResponse = await allowed.app.request(
			"/api/sync/v1/workspaces",
			{ headers: syncHeaders(allowed.headers) },
		);
		expect(allowedResponse.status).toBe(200);
		allowed.store.close();

		const rejected = await createFixture({ email: "other@example.com" });
		const rejectedResponse = await rejected.app.request(
			"/api/sync/v1/workspaces",
			{ headers: syncHeaders(rejected.headers) },
		);
		expect(rejectedResponse.status).toBe(403);
		expect(await rejectedResponse.json()).toEqual({ error: "Forbidden" });
		rejected.store.close();

		const unverified = await createFixture({
			email: "owner@example.com",
			emailVerified: false,
		});
		const unverifiedResponse = await unverified.app.request(
			"/api/sync/v1/workspaces",
			{ headers: syncHeaders(unverified.headers) },
		);
		expect(unverifiedResponse.status).toBe(403);
		unverified.store.close();
	});

	test("keeps workspace membership checks after email authorization", async () => {
		const fixture = await createFixture({ email: "owner@example.com" });
		const response = await fixture.app.request(
			"/api/sync/v1/checkpoints/latest?workspaceId=not-a-member",
			{ headers: syncHeaders(fixture.headers) },
		);
		expect(response.status).toBe(403);
		fixture.store.close();
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
		fixture.store.close();
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
		fixture.store.close();
	});
});
