import type { Database } from "bun:sqlite";
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

export const AGENT_TOKENS_PATH = "/api/sync/v1/agent-tokens";
export const DEVICE_PATH = "/api/sync/v1/device";
export const TEST_AUTH_SECRET =
	"contextboard-auth-test-secret-at-least-32-bytes";

const roots: string[] = [];
const databases: Database[] = [];
const stores: SyncStore[] = [];

export function cleanupFixtures() {
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
}

function createAuthConfiguration(root: string): AuthConfiguration {
	return {
		databasePath: join(root, "auth.sqlite"),
		baseURL: "http://localhost:3000",
		trustedOrigins: ["http://localhost:3000"],
		secret: TEST_AUTH_SECRET,
		githubClientId: "test-client",
		githubClientSecret: "test-secret",
	};
}

export async function createBrowserSession(
	auth: Awaited<ReturnType<typeof createContextboardAuth>>,
	email: string,
) {
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
		TEST_AUTH_SECRET,
	);
	return { user, browserHeaders: new Headers({ cookie }) };
}

export async function createFixture(email = "owner@example.com") {
	const root = mkdtempSync(join(tmpdir(), "contextboard-sync-int-"));
	roots.push(root);
	const auth = createContextboardAuth(createAuthConfiguration(root));
	databases.push(auth.options.database as Database);
	await migrateContextboardAuth(auth);
	const owner = await createBrowserSession(auth, email);
	const store = new SyncStore(":memory:", join(root, "blobs"));
	stores.push(store);
	const appFor = (allowed: string) =>
		createSyncApp(store, auth, {
			allowedEmails: parseAllowedEmails(allowed),
			publicAppUrl: "https://board.example.test",
		});
	return {
		auth,
		store,
		app: appFor(email),
		appFor,
		browserHeaders: owner.browserHeaders,
		user: owner.user,
		createBrowserSession: (userEmail: string) =>
			createBrowserSession(auth, userEmail),
	};
}

export const syncHeaders = (headers: HeadersInit = {}) =>
	new Headers({
		...syncVersionHeaders(),
		...Object.fromEntries(new Headers(headers)),
	});

export async function issueToken(
	fixture: Awaited<ReturnType<typeof createFixture>>,
	name = "remote box",
) {
	const response = await fixture.app.request(AGENT_TOKENS_PATH, {
		method: "POST",
		headers: new Headers({
			...Object.fromEntries(fixture.browserHeaders),
			"content-type": "application/json",
		}),
		body: JSON.stringify({ name }),
	});
	if (response.status !== 201)
		throw new Error(`Could not issue fixture token: ${response.status}`);
	return (await response.json()) as { id: string; token: string; name: string };
}
