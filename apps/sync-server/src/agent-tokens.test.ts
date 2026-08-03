import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_TOKEN_PREFIX,
	AgentTokenError,
	generateAgentToken,
	hashAgentToken,
	hashesMatch,
	isAgentToken,
	parseAgentTokenName,
	readBearerToken,
} from "./agent-tokens";
import { SyncStore } from "./store";

const createStore = () =>
	new SyncStore(
		":memory:",
		join(mkdtempSync(join(tmpdir(), "contextboard-agent-")), "blobs"),
	);

describe("agent token primitives", () => {
	test("generates prefixed, unique, high-entropy tokens", () => {
		const tokens = new Set(
			Array.from({ length: 50 }, () => generateAgentToken()),
		);
		expect(tokens.size).toBe(50);
		for (const token of tokens) {
			expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
			expect(isAgentToken(token)).toBe(true);
			// 32 bytes base64url is 43 characters.
			expect(token.length).toBe(AGENT_TOKEN_PREFIX.length + 43);
		}
	});

	test("hashes deterministically and does not embed the token", () => {
		const token = generateAgentToken();
		expect(hashAgentToken(token)).toBe(hashAgentToken(token));
		expect(hashAgentToken(token)).not.toBe(
			hashAgentToken(generateAgentToken()),
		);
		expect(hashAgentToken(token)).not.toContain(token.slice(5));
	});

	test("hashesMatch compares equal and unequal hashes", () => {
		const hash = hashAgentToken("a");
		expect(hashesMatch(hash, hashAgentToken("a"))).toBe(true);
		expect(hashesMatch(hash, hashAgentToken("b"))).toBe(false);
		expect(hashesMatch(hash, "beef")).toBe(false);
	});

	test("does not mistake Better Auth session tokens for agent tokens", () => {
		expect(isAgentToken("eyJhbGciOi.session.token")).toBe(false);
	});

	test("reads bearer tokens case-insensitively and ignores other schemes", () => {
		const request = (authorization?: string) =>
			new Request("http://localhost", {
				headers: authorization ? { authorization } : {},
			});
		expect(readBearerToken(request("Bearer abc"))).toBe("abc");
		expect(readBearerToken(request("bearer abc"))).toBe("abc");
		expect(readBearerToken(request("Basic abc"))).toBe(null);
		expect(readBearerToken(request("Bearer   "))).toBe(null);
		expect(readBearerToken(request())).toBe(null);
	});

	test("validates token names", () => {
		expect(parseAgentTokenName("  remote box  ")).toBe("remote box");
		expect(() => parseAgentTokenName("")).toThrow(AgentTokenError);
		expect(() => parseAgentTokenName(42)).toThrow(AgentTokenError);
		expect(() => parseAgentTokenName("x".repeat(65))).toThrow(AgentTokenError);
	});
});

describe("agent token storage", () => {
	test("issues a token that resolves back to its owner", () => {
		const store = createStore();
		const created = store.createAgentToken(
			"user-1",
			"owner@example.com",
			"remote box",
		);
		expect(isAgentToken(created.token)).toBe(true);
		expect(store.findActiveAgentToken(created.token)).toEqual({
			id: created.id,
			userId: "user-1",
			userEmail: "owner@example.com",
		});
		store.close();
	});

	test("stores only the hash, never the plaintext", () => {
		const store = createStore();
		const created = store.createAgentToken(
			"user-1",
			"owner@example.com",
			"box",
		);
		const rows = store.db.query("SELECT * FROM agent_tokens").all() as Array<
			Record<string, unknown>
		>;
		expect(JSON.stringify(rows)).not.toContain(created.token);
		expect(rows[0]?.token_hash).toBe(hashAgentToken(created.token));
		store.close();
	});

	test("rejects unknown tokens", () => {
		const store = createStore();
		store.createAgentToken("user-1", "owner@example.com", "box");
		expect(store.findActiveAgentToken(generateAgentToken())).toBe(null);
		store.close();
	});

	test("revokes a token so it stops resolving", () => {
		const store = createStore();
		const created = store.createAgentToken(
			"user-1",
			"owner@example.com",
			"box",
		);
		expect(store.revokeAgentToken("user-1", created.id)).toBe(true);
		expect(store.findActiveAgentToken(created.token)).toBe(null);
		// Revoking twice is not an error, but reports that nothing changed.
		expect(store.revokeAgentToken("user-1", created.id)).toBe(false);
		store.close();
	});

	test("does not let one user revoke another user's token", () => {
		const store = createStore();
		const created = store.createAgentToken(
			"user-1",
			"owner@example.com",
			"box",
		);
		expect(store.revokeAgentToken("intruder", created.id)).toBe(false);
		expect(store.findActiveAgentToken(created.token)).not.toBe(null);
		store.close();
	});

	test("lists only the owner's tokens without exposing hashes", () => {
		const store = createStore();
		store.createAgentToken("user-1", "owner@example.com", "first");
		const second = store.createAgentToken("user-1", "owner@example.com", "two");
		store.createAgentToken("user-2", "other@example.com", "theirs");
		const listed = store.listAgentTokens("user-1");
		expect(listed.map((token) => token.name).sort()).toEqual(["first", "two"]);
		expect(JSON.stringify(listed)).not.toContain("token_hash");
		store.revokeAgentToken("user-1", second.id);
		expect(
			store.listAgentTokens("user-1").find((t) => t.id === second.id)
				?.revokedAt,
		).toBeNumber();
		store.close();
	});

	test("throttles last_used_at writes to once a minute", () => {
		const store = createStore();
		const created = store.createAgentToken(
			"user-1",
			"owner@example.com",
			"box",
		);
		const lastUsed = () =>
			store.listAgentTokens("user-1")[0]?.lastUsedAt ?? null;

		const start = Date.now();
		store.touchAgentToken(created.id, start);
		expect(lastUsed()).toBe(start);

		// A poll a second later must not cause another write.
		store.touchAgentToken(created.id, start + 1_000);
		expect(lastUsed()).toBe(start);

		store.touchAgentToken(created.id, start + 61_000);
		expect(lastUsed()).toBe(start + 61_000);
		store.close();
	});
});
