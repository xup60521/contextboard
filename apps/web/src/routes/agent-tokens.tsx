import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/agent-tokens")({
	ssr: false,
	component: AgentTokensPage,
});

const ENDPOINT = "/api/sync/v1/agent-tokens";

type AgentToken = {
	id: string;
	name: string;
	createdAt: number;
	lastUsedAt: number | null;
	revokedAt: number | null;
};

async function readError(response: Response) {
	const body = (await response.json().catch(() => null)) as {
		error?: string;
	} | null;
	return body?.error ?? `Request failed with status ${response.status}`;
}

const formatDate = (value: number | null) =>
	value === null ? "Never" : new Date(value).toLocaleString();

function AgentTokensPage() {
	const [tokens, setTokens] = useState<AgentToken[] | null>(null);
	const [name, setName] = useState("");
	const [issued, setIssued] = useState<{ name: string; token: string } | null>(
		null,
	);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const response = await fetch(ENDPOINT, { credentials: "include" });
			if (!response.ok) throw new Error(await readError(response));
			setTokens((await response.json()) as AgentToken[]);
			setMessage(null);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
			setTokens([]);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const create = async () => {
		setBusy(true);
		try {
			const response = await fetch(ENDPOINT, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name }),
			});
			if (!response.ok) throw new Error(await readError(response));
			const created = (await response.json()) as {
				name: string;
				token: string;
			};
			// The only moment this value exists in the UI; it is unrecoverable after.
			setIssued({ name: created.name, token: created.token });
			setName("");
			await load();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const revoke = async (token: AgentToken) => {
		if (
			!window.confirm(
				`Revoke "${token.name}"? Any agent using it will stop working immediately.`,
			)
		)
			return;
		setBusy(true);
		try {
			const response = await fetch(`${ENDPOINT}/${token.id}`, {
				method: "DELETE",
				credentials: "include",
			});
			if (!response.ok) throw new Error(await readError(response));
			await load();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const active = (tokens ?? []).filter((token) => token.revokedAt === null);
	const revoked = (tokens ?? []).filter((token) => token.revokedAt !== null);

	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			{/* Anchored to the shell's content area rather than this centred
			    column: it is a shell control, and the only way back once the
			    sidebar is collapsed. */}
			<div className="absolute left-4 top-4">
				<SidebarOpenButton />
			</div>
			<h1 className="text-3xl font-semibold">Agent tokens</h1>
			<p className="mt-3 text-sm text-[var(--text-muted)]">
				Agent tokens let a coding agent on another machine reach this workspace
				without the desktop app running. They do not expire, so revoke any token
				you no longer recognise. A token cannot create or revoke other tokens.
			</p>

			<form
				className="mt-8 flex gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<input
					className="flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
					placeholder="Where will this token live? e.g. remote dev box"
					value={name}
					maxLength={64}
					onChange={(event) => setName(event.target.value)}
				/>
				<Button type="submit" disabled={busy || !name.trim()}>
					Create token
				</Button>
			</form>

			{issued ? (
				<section className="mt-6 rounded-md border border-[var(--border)] p-4">
					<h2 className="text-sm font-semibold">
						Copy “{issued.name}” now — it is shown only once
					</h2>
					<code className="mt-3 block break-all rounded bg-[var(--muted)] p-3 text-xs">
						{issued.token}
					</code>
					<p className="mt-3 text-sm text-[var(--text-muted)]">
						On the agent machine, save this to{" "}
						<code>~/.contextboard/credentials.json</code> and run{" "}
						<code>chmod 600</code> on it:
					</p>
					<code className="mt-2 block break-all rounded bg-[var(--muted)] p-3 text-xs">
						{JSON.stringify(
							{ token: issued.token, serverUrl: window.location.origin },
							null,
							2,
						)}
					</code>
					<div className="mt-3 flex gap-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								void navigator.clipboard?.writeText(issued.token);
								setMessage("Token copied to the clipboard.");
							}}
						>
							Copy token
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => setIssued(null)}
						>
							I have saved it
						</Button>
					</div>
				</section>
			) : null}

			{message ? (
				<p className="mt-4 text-sm text-[var(--text-muted)]">{message}</p>
			) : null}

			<h2 className="mt-10 text-lg font-semibold">Active tokens</h2>
			{tokens === null ? (
				<p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p>
			) : active.length === 0 ? (
				<p className="mt-3 text-sm text-[var(--text-muted)]">
					No active tokens.
				</p>
			) : (
				<ul className="mt-3 divide-y divide-[var(--border)]">
					{active.map((token) => (
						<li
							key={token.id}
							className="flex items-center justify-between gap-4 py-3"
						>
							<div>
								<p className="text-sm font-medium">{token.name}</p>
								<p className="text-xs text-[var(--text-muted)]">
									Created {formatDate(token.createdAt)} · Last used{" "}
									{formatDate(token.lastUsedAt)}
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => void revoke(token)}
							>
								Revoke
							</Button>
						</li>
					))}
				</ul>
			)}

			{revoked.length ? (
				<>
					<h2 className="mt-10 text-lg font-semibold">Revoked</h2>
					<ul className="mt-3 divide-y divide-[var(--border)]">
						{revoked.map((token) => (
							<li key={token.id} className="py-3">
								<p className="text-sm text-[var(--text-muted)]">
									{token.name} · revoked {formatDate(token.revokedAt)}
								</p>
							</li>
						))}
					</ul>
				</>
			) : null}
		</main>
	);
}
