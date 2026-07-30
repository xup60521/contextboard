import { oneTimeTokenClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: `${typeof window === "undefined" ? "http://localhost:3000" : window.location.origin}/api/auth`,
	plugins: [oneTimeTokenClient()],
});

export const useSession = authClient.useSession;

const POPUP_MESSAGE = "contextboard:auth-popup-complete";

export class AuthPopupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthPopupError";
	}
}

export async function signInWithGitHubPopup() {
	if (typeof window === "undefined")
		throw new AuthPopupError("GitHub sign in is only available in the browser");

	const popup = window.open(
		"about:blank",
		"contextboard-github-auth",
		"popup=yes,width=560,height=720,resizable=yes,scrollbars=yes",
	);
	if (!popup)
		throw new AuthPopupError(
			"Sign-in popup was blocked. Allow popups for this site and try again.",
		);

	const callbackURL = `${window.location.origin}/api/auth/popup-complete`;
	const result = await authClient.signIn.social({
		provider: "github",
		callbackURL,
		errorCallbackURL: callbackURL,
		disableRedirect: true,
	});
	if (result.error || !result.data?.url) {
		popup.close();
		throw new AuthPopupError(
			result.error?.message ?? "GitHub sign in could not be started",
		);
	}

	popup.location.assign(result.data.url);
	await waitForPopup(popup);
}

export function waitForPopup(popup: Window) {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			window.clearInterval(closedTimer);
			window.clearTimeout(timeout);
			window.removeEventListener("message", onMessage);
			if (error) reject(error);
			else resolve();
		};
		const onMessage = (event: MessageEvent) => {
			if (
				event.origin !== window.location.origin ||
				event.source !== popup ||
				!event.data ||
				event.data.type !== POPUP_MESSAGE
			)
				return;
			const oauthError =
				typeof event.data.error === "string" ? event.data.error : null;
			finish(
				oauthError
					? new AuthPopupError(`GitHub sign in failed: ${oauthError}`)
					: undefined,
			);
		};
		const closedTimer = window.setInterval(() => {
			if (popup.closed) finish(new AuthPopupError("Sign-in popup was closed"));
		}, 400);
		const timeout = window.setTimeout(() => {
			popup.close();
			finish(new AuthPopupError("GitHub sign in timed out"));
		}, 5 * 60_000);
		window.addEventListener("message", onMessage);
	});
}

export function signOut() {
	return authClient.signOut();
}

export class OneTimeTokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OneTimeTokenError";
	}
}

/**
 * Exchanges a one-time token for a signed bearer session token. Clients without
 * a cookie jar (the desktop shell) use this to finish a browser handoff; the
 * returned token is what Better Auth's bearer plugin accepts.
 */
export async function exchangeOneTimeToken(
	baseURL: string,
	token: string,
): Promise<string> {
	const response = await fetch(
		`${baseURL.replace(/\/$/, "")}/api/auth/one-time-token/verify`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token }),
		},
	);
	if (!response.ok)
		throw new OneTimeTokenError(
			response.status === 400 || response.status === 401
				? "The sign-in link has expired. Try again."
				: `Sign in could not be completed (${response.status})`,
		);
	const session = response.headers.get("set-auth-token");
	if (!session)
		throw new OneTimeTokenError("The server did not return a session token");
	return session;
}

export type BearerSessionUser = {
	id: string;
	name?: string | null;
	email?: string | null;
};

/**
 * Resolves the account behind a bearer token, or null when the token is no
 * longer valid. Cookie-less clients use this instead of `useSession`.
 */
export async function fetchBearerSession(
	baseURL: string,
	token: string,
	signal?: AbortSignal,
): Promise<BearerSessionUser | null> {
	const response = await fetch(
		`${baseURL.replace(/\/$/, "")}/api/auth/get-session`,
		{
			headers: { authorization: `Bearer ${token}` },
			signal,
		},
	);
	if (response.status === 401) return null;
	if (!response.ok)
		throw new OneTimeTokenError(
			`Could not verify the desktop session (${response.status})`,
		);
	const body = (await response.json().catch(() => null)) as {
		user?: BearerSessionUser;
	} | null;
	return body?.user ?? null;
}

/**
 * Mints a one-time token from the current cookie session. The browser side of
 * the desktop handoff calls this before redirecting back to the app.
 */
export async function generateOneTimeToken(): Promise<string> {
	const result = await authClient.oneTimeToken.generate();
	if (result.error || !result.data?.token)
		throw new OneTimeTokenError(
			result.error?.message ?? "Could not start the desktop handoff",
		);
	return result.data.token;
}
