import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeSignedCookie } from "better-call";
import {
	createContextboardAuth,
	migrateContextboardAuth,
	type AuthConfiguration,
} from "./index";

const roots: string[] = [];
const databases: Database[] = [];
const secret = "contextboard-auth-test-secret-at-least-32-bytes";

function configuration(protocol: "http" | "https" = "http") {
	const root = mkdtempSync(join(tmpdir(), "contextboard-auth-"));
	roots.push(root);
	return {
		databasePath: join(root, "auth.sqlite"),
		baseURL: `${protocol}://localhost:3000`,
		trustedOrigins: [`${protocol}://localhost:3000`],
		secret,
		githubClientId: "test-client",
		githubClientSecret: "test-secret",
	} satisfies AuthConfiguration;
}

afterEach(() => {
	for (const database of databases.splice(0)) database.close();
	for (const root of roots.splice(0)) {
		try {
			rmSync(root, { recursive: true, force: true });
		} catch (error) {
			// Bun's SQLite/Kysely adapter can retain a Windows file handle until
			// process exit. The directory is already isolated under the OS temp
			// root, so an EBUSY cleanup miss must not hide an auth assertion.
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "EBUSY"
			)
				throw error;
		}
	}
});

function createAuth(config: AuthConfiguration) {
	const auth = createContextboardAuth(config);
	databases.push(auth.options.database as Database);
	return auth;
}

async function createAuthenticatedFixture(protocol: "http" | "https" = "http") {
	const config = configuration(protocol);
	const auth = createAuth(config);
	await migrateContextboardAuth(auth);
	const context = await auth.$context;
	const user = await context.internalAdapter.createUser({
		id: crypto.randomUUID(),
		name: "Test User",
		email: `${crypto.randomUUID()}@example.test`,
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
	return {
		auth,
		config,
		context,
		session,
		headers: new Headers({ cookie }),
	};
}

describe("Context Board auth", () => {
	test("migrations are idempotent", async () => {
		const auth = createAuth(configuration());
		const first = await migrateContextboardAuth(auth);
		const second = await migrateContextboardAuth(auth);
		expect(first.createdTables).toBeGreaterThan(0);
		expect(second).toEqual({ createdTables: 0, addedColumns: 0 });
	});

	test("keeps OAuth state in the database and encrypts provider tokens", () => {
		const auth = createAuth(configuration());
		expect(auth.options.account?.storeStateStrategy).toBe("database");
		expect(auth.options.account?.encryptOAuthTokens).toBe(true);
		expect(JSON.stringify(auth.options)).not.toContain("allowlist");
	});

	test("uses environment-appropriate secure cookies with HttpOnly and SameSite=Lax", async () => {
		for (const protocol of ["http", "https"] as const) {
			const { auth, headers } = await createAuthenticatedFixture(protocol);
			const generated = await auth.api.generateOneTimeToken({ headers });
			const response = await auth.api.verifyOneTimeToken({
				body: { token: generated.token },
				returnHeaders: true,
			});
			const setCookie = response.headers.get("set-cookie") ?? "";
			expect(setCookie.toLowerCase()).toContain("httponly");
			expect(setCookie.toLowerCase()).toContain("samesite=lax");
			expect(setCookie.toLowerCase().includes("secure")).toBe(
				protocol === "https",
			);
		}
	});

	test("stores only hashed OTTs and rejects wrong, expired, and replayed tokens", async () => {
		const { auth, config, headers } = await createAuthenticatedFixture();
		const generated = await auth.api.generateOneTimeToken({ headers });
		const database = new Database(config.databasePath);
		databases.push(database);
		const stored = database
			.query("SELECT identifier, expiresAt FROM verification")
			.get() as { identifier: string; expiresAt: string | number };
		expect(stored.identifier).toMatch(/^one-time-token:/);
		expect(stored.identifier).not.toContain(generated.token);
		const expiresAt = new Date(stored.expiresAt).getTime();
		expect(expiresAt).toBeGreaterThan(Date.now());
		expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3 * 60_000);

		await expect(
			auth.api.verifyOneTimeToken({ body: { token: "wrong-token" } }),
		).rejects.toThrow("Invalid token");
		await expect(
			auth.api.verifyOneTimeToken({ body: { token: generated.token } }),
		).resolves.toMatchObject({ user: { emailVerified: true } });
		await expect(
			auth.api.verifyOneTimeToken({ body: { token: generated.token } }),
		).rejects.toThrow("Invalid token");

		const expiring = await auth.api.generateOneTimeToken({ headers });
		database
			.query(
				"UPDATE verification SET expiresAt = ? WHERE identifier LIKE 'one-time-token:%'",
			)
			.run(0);
		await expect(
			auth.api.verifyOneTimeToken({ body: { token: expiring.token } }),
		).rejects.toThrow("Invalid token");
	});

	test("cookie and signed bearer sessions both use Better Auth getSession", async () => {
		const { auth, headers } = await createAuthenticatedFixture();
		const cookieSession = await auth.api.getSession({ headers });
		expect(cookieSession?.user.emailVerified).toBe(true);

		const generated = await auth.api.generateOneTimeToken({ headers });
		const verified = await auth.api.verifyOneTimeToken({
			body: { token: generated.token },
			returnHeaders: true,
		});
		const bearer = verified.headers.get("set-auth-token");
		expect(bearer).toBeTruthy();
		const bearerSession = await auth.api.getSession({
			headers: new Headers({ authorization: `Bearer ${bearer}` }),
		});
		expect(bearerSession?.user.id).toBe(cookieSession?.user.id);
	});
});
