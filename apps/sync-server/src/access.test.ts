import { describe, expect, test } from "bun:test";
import { isAllowedUser, normalizeEmail, parseAllowedEmails } from "./access";
import { allowedEmails } from "./configuration";

describe("email access policy", () => {
	test("normalizes email addresses for exact matching", () => {
		expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
		const allowed = parseAllowedEmails(" User@example.com, user@example.com ");
		expect(allowed).toEqual(new Set(["user@example.com"]));
	});

	test("requires at least one valid configured email", () => {
		expect(() => parseAllowedEmails("")).toThrow(
			"CONTEXTBOARD_ALLOWED_EMAILS must contain at least one email",
		);
		expect(() => parseAllowedEmails("not-an-email")).toThrow(
			"Invalid email in CONTEXTBOARD_ALLOWED_EMAILS",
		);
	});

	test("requires a verified allowlisted email", () => {
		const allowed = parseAllowedEmails("owner@example.com");
		expect(
			isAllowedUser(
				{ email: "OWNER@example.com", emailVerified: true },
				allowed,
			),
		).toBe(true);
		expect(
			isAllowedUser(
				{ email: "owner@example.com", emailVerified: false },
				allowed,
			),
		).toBe(false);
		expect(isAllowedUser({ email: null, emailVerified: true }, allowed)).toBe(
			false,
		);
		expect(
			isAllowedUser(
				{ email: "other@example.com", emailVerified: true },
				allowed,
			),
		).toBe(false);
	});

	test("requires the environment variable at server startup", () => {
		const previous = process.env.CONTEXTBOARD_ALLOWED_EMAILS;
		try {
			delete process.env.CONTEXTBOARD_ALLOWED_EMAILS;
			expect(() => allowedEmails()).toThrow(
				"CONTEXTBOARD_ALLOWED_EMAILS is required",
			);
			process.env.CONTEXTBOARD_ALLOWED_EMAILS = "";
			expect(() => allowedEmails()).toThrow(
				"CONTEXTBOARD_ALLOWED_EMAILS is required",
			);
		} finally {
			if (previous === undefined)
				delete process.env.CONTEXTBOARD_ALLOWED_EMAILS;
			else process.env.CONTEXTBOARD_ALLOWED_EMAILS = previous;
		}
	});
});
