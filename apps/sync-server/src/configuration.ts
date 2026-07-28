import { join } from "node:path";
import { createContextboardAuth } from "@contextboard/auth";

export const dataRoot = process.env.CONTEXTBOARD_DATA_DIR ?? "/data";

export function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

export function createServerAuth() {
	return createContextboardAuth({
		databasePath: join(dataRoot, "auth.sqlite"),
		baseURL: required("BETTER_AUTH_URL"),
		trustedOrigins: required("BETTER_AUTH_TRUSTED_ORIGINS")
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
		secret: required("BETTER_AUTH_SECRET"),
		githubClientId: required("GITHUB_CLIENT_ID"),
		githubClientSecret: required("GITHUB_CLIENT_SECRET"),
	});
}
