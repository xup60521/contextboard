import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";

export type AuthConfiguration = {
	databasePath: string;
	baseURL: string;
	trustedOrigins: string[];
	secret: string;
	githubClientId: string;
	githubClientSecret: string;
};

export function createContextboardAuth(configuration: AuthConfiguration) {
	mkdirSync(dirname(configuration.databasePath), { recursive: true });
	return betterAuth({
		appName: "Context Board",
		database: new Database(configuration.databasePath, { create: true }),
		baseURL: configuration.baseURL,
		secret: configuration.secret,
		trustedOrigins: configuration.trustedOrigins,
		account: {
			encryptOAuthTokens: true,
			storeStateStrategy: "database",
		},
		socialProviders: {
			github: {
				clientId: configuration.githubClientId,
				clientSecret: configuration.githubClientSecret,
				scope: ["read:user", "user:email"],
			},
		},
		plugins: [
			bearer({ requireSignature: true }),
			oneTimeToken({ expiresIn: 3, storeToken: "hashed" }),
		],
		advanced: {
			defaultCookieAttributes: {
				secure: new URL(configuration.baseURL).protocol === "https:",
				httpOnly: true,
				sameSite: "lax",
			},
		},
	});
}

export type ContextboardAuth = ReturnType<typeof createContextboardAuth>;

export async function migrateContextboardAuth(auth: ContextboardAuth) {
	const migrations = await getMigrations(auth.options);
	await migrations.runMigrations();
	return {
		createdTables: migrations.toBeCreated.length,
		addedColumns: migrations.toBeAdded.length,
	};
}
