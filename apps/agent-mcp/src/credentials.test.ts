import { describe, expect, test } from "vitest";
import {
	CredentialsError,
	checkCredentialsPermissions,
	credentialsPath,
	loadAgentCredentials,
} from "./credentials";

const file = (contents: string) => () => Promise.resolve(contents);
const missing = () => Promise.reject(new Error("ENOENT"));
const posix = {
	currentPlatform: "linux",
	statFile: async () => ({ mode: 0o600 }),
};

describe("agent credentials", () => {
	test("prefers the environment so containers need no file", async () => {
		const credentials = await loadAgentCredentials({
			env: {
				CONTEXTBOARD_AGENT_TOKEN: "  cbat_env  ",
				CONTEXTBOARD_SYNC_URL: "https://board.example.com/",
			},
			readCredentialsFile: file('{"token":"cbat_file","serverUrl":"http://x"}'),
			...posix,
		});
		expect(credentials).toEqual({
			token: "cbat_env",
			serverUrl: "https://board.example.com",
		});
	});

	test("requires a server URL alongside an environment token", async () => {
		await expect(
			loadAgentCredentials({
				env: { CONTEXTBOARD_AGENT_TOKEN: "cbat_env" },
				readCredentialsFile: missing,
				...posix,
			}),
		).rejects.toThrow(CredentialsError);
	});

	test("falls back to the credentials file and trims trailing slashes", async () => {
		const credentials = await loadAgentCredentials({
			env: {},
			readCredentialsFile: file(
				'{"token":"cbat_file","serverUrl":"https://board.example.com//"}',
			),
			...posix,
		});
		expect(credentials).toEqual({
			token: "cbat_file",
			serverUrl: "https://board.example.com",
		});
	});

	test("returns null when nothing is configured", async () => {
		expect(
			await loadAgentCredentials({
				env: {},
				readCredentialsFile: missing,
				...posix,
			}),
		).toBe(null);
	});

	test("rejects malformed or incomplete credentials files", async () => {
		const load = (contents: string) =>
			loadAgentCredentials({
				env: {},
				readCredentialsFile: file(contents),
				...posix,
			});
		await expect(load("not json")).rejects.toThrow(CredentialsError);
		await expect(load('{"serverUrl":"http://x"}')).rejects.toThrow(
			CredentialsError,
		);
		await expect(load('{"token":"cbat_x"}')).rejects.toThrow(CredentialsError);
		await expect(load('{"token":"  ","serverUrl":"http://x"}')).rejects.toThrow(
			CredentialsError,
		);
	});

	test("warns when the credentials file is readable by other users", async () => {
		const warnings: string[] = [];
		await loadAgentCredentials({
			env: {},
			readCredentialsFile: file('{"token":"cbat_x","serverUrl":"http://x"}'),
			currentPlatform: "linux",
			statFile: async () => ({ mode: 0o644 }),
			warn: (message) => warnings.push(message),
		});
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("chmod 600");
	});

	test("does not warn for owner-only permissions", async () => {
		const warnings: string[] = [];
		await loadAgentCredentials({
			env: {},
			readCredentialsFile: file('{"token":"cbat_x","serverUrl":"http://x"}'),
			warn: (message) => warnings.push(message),
			...posix,
		});
		expect(warnings).toEqual([]);
	});

	test("skips the permission check on Windows, where st_mode is meaningless", async () => {
		expect(
			await checkCredentialsPermissions("C:\\creds.json", {
				currentPlatform: "win32",
				statFile: async () => ({ mode: 0o777 }),
			}),
		).toBe(null);
	});

	test("resolves the credentials path under the home directory", () => {
		expect(credentialsPath("/home/me")).toContain(".contextboard");
		expect(credentialsPath("/home/me")).toContain("credentials.json");
	});
});
