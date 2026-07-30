import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	exportLocalArchive,
	importArchive,
} from "#/integrations/local/archive";
import { useLocalDatabase } from "#/integrations/local/provider";
import { localMutation } from "#/integrations/local/operations";
import { useSyncRuntime } from "#/integrations/sync/provider";

export const Route = createFileRoute("/data")({
	ssr: false,
	component: DataManagementPage,
});

function DataManagementPage() {
	const local = useLocalDatabase();
	const sync = useSyncRuntime();
	const resolveConflict = async (input: {
		conflictId: string;
		resolution: "keep-local" | "keep-remote" | "keep-both";
	}) => {
		if (local.status !== "ready") return;
		await localMutation(
			local.database,
			local.deviceId,
			"conflicts.resolve",
			input,
		);
		sync.notifyLocalChange();
	};
	const unresolvedConflicts =
		useLiveQuery(
			() =>
				local.status === "ready"
					? local.database.conflicts
							.toArray()
							.then((rows) => rows.filter((row) => row.resolvedAt === null))
					: [],
			[local.status, local.database],
		) ?? [];
	const inputRef = useRef<HTMLInputElement>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const exportData = async () => {
		setBusy(true);
		try {
			const archive = await exportLocalArchive(local.database);
			const url = URL.createObjectURL(archive);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `contextboard-${new Date().toISOString().slice(0, 10)}.contextboard.zip`;
			anchor.click();
			URL.revokeObjectURL(url);
			setMessage("Backup created.");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const importData = async (file: File) => {
		setBusy(true);
		try {
			const estimate = await navigator.storage?.estimate?.();
			const available =
				estimate?.quota !== undefined
					? estimate.quota - (estimate.usage ?? 0)
					: undefined;
			if (available !== undefined && file.size * 2 > available)
				throw new Error(
					"There is not enough browser storage available to import this archive safely.",
				);
			const result = await importArchive(
				local.database,
				await file.arrayBuffer(),
			);
			setMessage(
				`Imported ${Object.values(result.counts).reduce((sum, count) => sum + count, 0)} records. Reloading…`,
			);
			window.location.reload();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
			setBusy(false);
		}
	};

	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<h1 className="text-3xl font-semibold">Local data</h1>
			<p className="mt-3 text-sm text-[var(--text-muted)]">
				This workspace is stored in this browser. Export backups regularly.
				Import replaces the current workspace only after the archive passes
				validation.
			</p>
			<div className="mt-8 flex gap-3">
				<Button
					type="button"
					disabled={busy || local.status !== "ready"}
					onClick={() => void exportData()}
				>
					Export backup
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={busy || local.status !== "ready"}
					onClick={() => inputRef.current?.click()}
				>
					Import backup or Convex export
				</Button>
				<input
					ref={inputRef}
					className="hidden"
					type="file"
					accept=".zip,.contextboard"
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) void importData(file);
					}}
				/>
			</div>
			{message ? (
				<p className="mt-4 text-sm" role="status">
					{message}
				</p>
			) : null}
			<section className="mt-10 rounded-lg border border-[var(--border)] p-4">
				<h2 className="text-sm font-semibold">Synchronization</h2>
				<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
					<dt className="text-[var(--text-muted)]">State</dt>
					<dd>{sync.state.state}</dd>
					<dt className="text-[var(--text-muted)]">Workspace</dt>
					<dd className="truncate font-mono">
						{sync.state.workspaceId ?? "opening"}
					</dd>
					<dt className="text-[var(--text-muted)]">Device</dt>
					<dd className="truncate font-mono">
						{local.status === "ready" ? local.deviceId : "opening"}
					</dd>
					<dt className="text-[var(--text-muted)]">Pull cursor</dt>
					<dd>{sync.state.cursor ?? "none"}</dd>
					<dt className="text-[var(--text-muted)]">Pending batches</dt>
					<dd>{sync.state.pendingCount}</dd>
					<dt className="text-[var(--text-muted)]">Conflicts</dt>
					<dd>{sync.state.conflictCount}</dd>
				</dl>
				{sync.state.error ? (
					<p className="mt-3 text-xs text-red-600" role="alert">
						{sync.state.error}
					</p>
				) : null}
				<Button
					type="button"
					variant="outline"
					className="mt-4"
					disabled={!sync.signedIn || sync.state.state === "syncing"}
					onClick={() => void sync.syncNow()}
				>
					Sync now
				</Button>
			</section>
			{unresolvedConflicts.length ? (
				<section
					id="conflicts"
					className="mt-6 scroll-mt-6 rounded-lg border border-amber-500/40 p-4"
				>
					<h2 className="text-sm font-semibold">
						Conflicts ({unresolvedConflicts.length})
					</h2>
					<div className="mt-3 space-y-3">
						{unresolvedConflicts.map((conflict) => (
							<article
								key={conflict.conflictId}
								className="rounded-md bg-[var(--muted)]/40 p-3 text-xs"
							>
								<p className="font-medium">
									{conflict.entityType}: {conflict.entityId}
								</p>
								<details className="mt-2">
									<summary className="cursor-pointer">Compare values</summary>
									<div className="mt-2 grid gap-2 md:grid-cols-2">
										<pre className="overflow-auto rounded bg-black/5 p-2">
											{JSON.stringify(conflict.localValue, null, 2)}
										</pre>
										<pre className="overflow-auto rounded bg-black/5 p-2">
											{JSON.stringify(conflict.remoteValue, null, 2)}
										</pre>
									</div>
								</details>
								<div className="mt-3 flex flex-wrap gap-2">
									{(["keep-local", "keep-remote", "keep-both"] as const).map(
										(resolution) => (
											<Button
												key={resolution}
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													void resolveConflict({
														conflictId: conflict.conflictId,
														resolution,
													})
												}
											>
												{resolution === "keep-local"
													? "Keep local"
													: resolution === "keep-remote"
														? "Keep remote"
														: "Keep both"}
											</Button>
										),
									)}
								</div>
							</article>
						))}
					</div>
				</section>
			) : null}
		</main>
	);
}
