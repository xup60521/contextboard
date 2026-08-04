import { signInWithGitHubPopup, useSession } from "@contextboard/auth-client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/device")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>) => ({
		user_code: typeof search.user_code === "string" ? search.user_code : undefined,
	}),
	component: DevicePage,
});

const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

type AuthorizationRequest = {
	userCode: string;
	clientName: string;
	deviceName: string | null;
	expiresAt: number;
	status: "pending";
};

type Phase = "code" | "loading" | "confirm" | "submitting" | "done" | "expired";

function formatCode(value: string) {
	const normalized = value
		.toUpperCase()
		.split("")
		.filter((character) => USER_CODE_ALPHABET.includes(character))
		.join("")
		.slice(0, 8);
	return normalized.length > 4
		? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
		: normalized;
}

async function readError(response: Response) {
	const body = (await response.json().catch(() => null)) as {
		error?: unknown;
		error_description?: unknown;
	} | null;
	return typeof body?.error_description === "string"
		? body.error_description
		: typeof body?.error === "string"
			? body.error
			: `Request failed with status ${response.status}`;
}

function removeCodeFromUrl() {
	const url = new URL(window.location.href);
	url.searchParams.delete("user_code");
	window.history.replaceState(
		window.history.state,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
}

function DevicePage() {
	const session = useSession();
	const { user_code: initialCode } = Route.useSearch();
	const [code, setCode] = useState("");
	const [request, setRequest] = useState<AuthorizationRequest | null>(null);
	const [phase, setPhase] = useState<Phase>("code");
	const [decision, setDecision] = useState<"approve" | "deny" | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const prefilled = useRef(false);

	useEffect(() => {
		if (!initialCode || prefilled.current) return;
		prefilled.current = true;
		setCode(formatCode(initialCode));
		removeCodeFromUrl();
	}, [initialCode]);

	useEffect(() => {
		if (!request || (phase !== "confirm" && phase !== "submitting")) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [phase, request]);

	const secondsRemaining = useMemo(
		() =>
			request ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000)) : null,
		[request, now],
	);

	useEffect(() => {
		if (phase === "confirm" && secondsRemaining === 0) setPhase("expired");
	}, [phase, secondsRemaining]);

	const lookup = async () => {
		const normalized = code.replace("-", "");
		if (normalized.length !== 8) {
			setMessage("Enter the eight-character code shown on the other machine.");
			return;
		}
		setPhase("loading");
		setMessage(null);
		try {
			const response = await fetch(
				`/api/sync/v1/device/authorization?user_code=${encodeURIComponent(normalized)}`,
				{ credentials: "include" },
			);
			if (!response.ok) throw new Error(await readError(response));
			setRequest((await response.json()) as AuthorizationRequest);
			setNow(Date.now());
			setPhase("confirm");
		} catch (error) {
			setPhase("code");
			setMessage(error instanceof Error ? error.message : String(error));
		}
	};

	const decide = async (action: "approve" | "deny") => {
		if (!request) return;
		setPhase("submitting");
		setMessage(null);
		try {
			const response = await fetch("/api/sync/v1/device/authorization", {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ userCode: request.userCode, action }),
			});
			if (!response.ok) throw new Error(await readError(response));
			setDecision(action);
			setPhase("done");
		} catch (error) {
			setPhase("confirm");
			setMessage(error instanceof Error ? error.message : String(error));
		}
	};

	if (session.isPending)
		return (
			<DeviceShell title="Checking your session">
				<p>One moment while we check whether you are signed in.</p>
			</DeviceShell>
		);

	if (!session.data?.user)
		return (
			<DeviceShell title="Approve a device sign-in">
				<p>
					Sign in with GitHub to confirm a ContextBoard agent on another machine.
				</p>
				<Button
					type="button"
					onClick={() =>
						void signInWithGitHubPopup()
							.then(() => session.refetch())
							.catch((error: unknown) =>
								setMessage(error instanceof Error ? error.message : String(error)),
							)
					}
				>
					Sign in with GitHub
				</Button>
				{message ? <p role="alert">{message}</p> : null}
			</DeviceShell>
		);

	if (phase === "done")
		return (
			<DeviceShell title={decision === "approve" ? "Device approved" : "Device denied"}>
				<p>
					{decision === "approve"
						? "The other machine can finish signing in now. You can close this page."
						: "This device will not receive access to your workspace. You can close this page."}
				</p>
			</DeviceShell>
		);

	if (phase === "expired")
		return (
			<DeviceShell title="This request expired">
				<p>Start a new sign-in on the other machine and enter its fresh code.</p>
				<Button type="button" variant="outline" onClick={() => setPhase("code")}>
					Enter another code
				</Button>
			</DeviceShell>
		);

	if (request)
		return (
			<DeviceShell title="Confirm this device">
				<div className="space-y-5">
					<div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/60 p-4">
						<dl className="grid gap-3 text-sm sm:grid-cols-2">
							<div>
								<dt className="island-kicker">Client</dt>
								<dd className="mt-1 font-medium text-[var(--sea-ink)]">
									{request.clientName}
								</dd>
							</div>
							<div>
								<dt className="island-kicker">Device</dt>
								<dd className="mt-1 font-medium text-[var(--sea-ink)]">
									{request.deviceName || "Unnamed device"}
								</dd>
							</div>
						</dl>
					</div>
					<div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-[var(--sea-ink)]">
						<strong>Only approve this if you just started a sign-in on that machine.</strong>{" "}
						Anyone who gets this code could otherwise gain access to your workspace.
					</div>
					<p className="text-sm text-[var(--sea-ink-soft)]">
						This request expires in <strong>{secondsRemaining}s</strong>.
					</p>
					<div className="flex flex-col gap-3 sm:flex-row">
						<Button
							type="button"
							disabled={phase === "submitting" || secondsRemaining === 0}
							onClick={() => void decide("approve")}
						>
							Approve device
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={phase === "submitting"}
							onClick={() => void decide("deny")}
						>
							Deny
						</Button>
					</div>
					{message ? <p role="alert">{message}</p> : null}
				</div>
			</DeviceShell>
		);

	return (
		<DeviceShell title="Approve a device sign-in">
			<form
				className="space-y-5"
				onSubmit={(event) => {
					event.preventDefault();
					void lookup();
				}}
			>
				<p>Enter the code shown by the ContextBoard agent on the other machine.</p>
				<label className="block" htmlFor="device-code">
					<span className="island-kicker">Device code</span>
					<input
						id="device-code"
						className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 font-mono text-2xl tracking-[0.18em] text-[var(--sea-ink)] outline-none focus:border-[var(--ring)] focus:ring-4 focus:ring-[var(--ring)]/20"
						inputMode="text"
						autoComplete="one-time-code"
						placeholder="XXXX-XXXX"
						value={code}
						onChange={(event) => setCode(formatCode(event.target.value))}
						aria-describedby="device-code-help"
					/>
					<span id="device-code-help" className="mt-2 block text-xs text-[var(--sea-ink-soft)]">
						The code is never approved automatically from a link.
					</span>
				</label>
				<Button type="submit" disabled={phase === "loading" || code.length !== 9}>
					{phase === "loading" ? "Looking up…" : "Review request"}
				</Button>
				{message ? <p role="alert">{message}</p> : null}
			</form>
		</DeviceShell>
	);
}

function DeviceShell({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<main className="page-wrap px-4 py-12 sm:py-20">
			<section className="island-shell mx-auto max-w-xl rounded-2xl p-6 sm:p-10">
				<p className="island-kicker mb-3">ContextBoard access</p>
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
					{title}
				</h1>
				<div className="mt-5 space-y-4 text-base leading-7 text-[var(--sea-ink-soft)]">
					{children}
				</div>
			</section>
		</main>
	);
}
