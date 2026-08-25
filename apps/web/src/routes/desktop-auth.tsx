import {
	generateOneTimeToken,
	signInWithGitHubPopup,
	useSession,
} from "@contextboard/auth-client";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Github, Loader2, XCircle } from "lucide-react";
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
			<DesktopAuthShell title="This link is not valid" icon={<XCircle />}>
				<p>
					Open Contextboard on your desktop and choose "Sign in with GitHub"
					there.
				</p>
			</DesktopAuthShell>
		);

	if (status === "error")
		return (
			<DesktopAuthShell title="Sign in failed" icon={<XCircle />}>
				<p>{message}</p>
				<Button type="button" onClick={() => void complete()}>
					Try again
				</Button>
			</DesktopAuthShell>
		);

	if (signedIn)
		return (
			<DesktopAuthShell
				title="Connecting your desktop app"
				icon={<CheckCircle2 className="text-emerald-500" />}
			>
				<p>Returning you to Contextboard. You can close this tab.</p>
			</DesktopAuthShell>
		);

	if (session.isPending)
		return (
			<DesktopAuthShell
				title="Connecting your desktop app"
				icon={<Loader2 className="animate-spin" />}
			>
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
				<Github /> Sign in with GitHub
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
	icon,
	children,
}: {
	title: string;
	icon?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_top,var(--hero-a),var(--bg-base)_60%)] px-4 py-12">
			<section className="island-shell w-full max-w-sm rounded-2xl p-6 text-center sm:p-8">
				{icon ? (
					<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--sea-ink)] [&>svg]:h-6 [&>svg]:w-6">
						{icon}
					</div>
				) : null}
				<p className="island-kicker mb-2">Contextboard desktop</p>
				<h1 className="display-title text-xl font-bold text-[var(--sea-ink)] sm:text-2xl">
					{title}
				</h1>
				<div className="mt-4 space-y-4 text-base leading-7 text-[var(--sea-ink-soft)] [&>button]:mx-auto [&>button]:flex [&>button]:items-center [&>button]:gap-2">
					{children}
				</div>
			</section>
		</main>
	);
}
