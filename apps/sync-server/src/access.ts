export type AllowedEmailSet = ReadonlySet<string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export function parseAllowedEmails(value: string): Set<string> {
	const emails = new Set<string>();
	for (const candidate of value.split(",")) {
		const email = normalizeEmail(candidate);
		if (!email) continue;
		if (!EMAIL_PATTERN.test(email))
			throw new Error(
				`Invalid email in CONTEXTBOARD_ALLOWED_EMAILS: ${candidate}`,
			);
		emails.add(email);
	}
	if (!emails.size)
		throw new Error(
			"CONTEXTBOARD_ALLOWED_EMAILS must contain at least one email",
		);
	return emails;
}

export function isAllowedUser(
	user: { email?: string | null; emailVerified?: boolean },
	allowedEmails: AllowedEmailSet,
) {
	return (
		user.emailVerified === true &&
		typeof user.email === "string" &&
		allowedEmails.has(normalizeEmail(user.email))
	);
}
