import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: `${typeof window === "undefined" ? "http://localhost:3000" : window.location.origin}/api/auth`,
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

function waitForPopup(popup: Window) {
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
