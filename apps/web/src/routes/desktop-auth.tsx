import {
	generateOneTimeToken,
	signInWithGitHubPopup,
	useSession,
} from "@contextboard/auth-client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/desktop-auth")({
	ssr: false,
	component: DesktopAuthPage,
});

/**
 * Browser half of the desktop sign-in handoff. The desktop shell opens this
 * page with a loopback `redirect`, and once a cookie session exists we mint a
 * one-time token and hand it back. The desktop exchanges that token for a
 * bearer session itself, so no long-lived credential is ever put in a URL.
 */
function DesktopAuthPage() {
	const session = useSession();
	const [status, setStatus] = useState<"idle" | "working" | "sent" | "error">(
		"idle",
	);
	const [message, setMessage] = useState<string | null>(null);
	const redirect = useLoopbackRedirect();

	const complete = useCallback(async () => {
		if (!redirect) return;
		setStatus("working");
		try {
			const token = await generateOneTimeToken();
			setStatus("sent");
			window.location.replace(`${redirect}?token=${encodeURIComponent(token)}`);
		} catch (error) {
			setStatus("error");
			const reason = error instanceof Error ? error.message : String(error);
			setMessage(reason);
			window.location.replace(
				`${redirect}?error=${encodeURIComponent(reason)}`,
			);
		}
	}, [redirect]);

	const signedIn = Boolean(session.data?.user);
	useEffect(() => {
		if (signedIn && status === "idle") void complete();
	}, [complete, signedIn, status]);

	if (!redirect)
		return (
			<DesktopAuthShell title="This link is not valid">
				<p>
					Open Contextboard on your desktop and choose “Sign in with GitHub”
					there.
				</p>
			</DesktopAuthShell>
		);

	if (status === "error")
		return (
			<DesktopAuthShell title="Sign in failed">
				<p>{message}</p>
				<Button type="button" onClick={() => void complete()}>
					Try again
				</Button>
			</DesktopAuthShell>
		);

	if (signedIn)
		return (
			<DesktopAuthShell title="Connecting your desktop app">
				<p>Returning you to Contextboard. You can close this tab.</p>
			</DesktopAuthShell>
		);

	if (session.isPending)
		return (
			<DesktopAuthShell title="Connecting your desktop app">
				<p>Checking your session…</p>
			</DesktopAuthShell>
		);

	return (
		<DesktopAuthShell title="Connect your desktop app">
			<p>Sign in to let Contextboard on this device sync your workspace.</p>
			<Button
				type="button"
				onClick={() => {
					void signInWithGitHubPopup()
						.then(() => session.refetch())
						.catch((error: unknown) => {
							setStatus("error");
							setMessage(
								error instanceof Error ? error.message : String(error),
							);
						});
				}}
			>
				Sign in with GitHub
			</Button>
		</DesktopAuthShell>
	);
}

/**
 * Only loopback callbacks are honoured, so this page can never be used to
 * forward a token to a third-party origin.
 */
function useLoopbackRedirect() {
	const [redirect, setRedirect] = useState<string | null>(null);
	useEffect(() => {
		const value = new URLSearchParams(window.location.search).get("redirect");
		if (!value) return;
		let parsed: URL;
		try {
			parsed = new URL(value);
		} catch {
			return;
		}
		if (
			parsed.protocol === "http:" &&
			(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
			parsed.pathname === "/callback" &&
			!parsed.search &&
			!parsed.hash
		)
			setRedirect(parsed.toString());
	}, []);
	return redirect;
}

function DesktopAuthShell({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<main className="page-wrap px-4 py-12">
			<section className="island-shell mx-auto max-w-lg space-y-4 rounded-2xl p-6 sm:p-8">
				<h1 className="display-title text-2xl font-bold text-[var(--sea-ink)]">
					{title}
				</h1>
				<div className="space-y-3 text-base leading-7 text-[var(--sea-ink-soft)]">
					{children}
				</div>
			</section>
		</main>
	);
}
