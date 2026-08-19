import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import {
	ConflictInbox,
	type ConflictResolution,
} from "#/components/data/ConflictInbox";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import { Button } from "#/components/ui/button";
import {
	exportLocalArchive,
	importArchive,
} from "#/integrations/local/archive";
import { localMutation } from "#/integrations/local/operations";
import { useLocalDatabase } from "#/integrations/local/provider";
import { useSyncRuntime } from "#/integrations/sync/provider";

export const Route = createFileRoute("/data")({
	ssr: false,
	component: DataManagementPage,
});

function DataManagementPage() {
	const local = useLocalDatabase();
	const sync = useSyncRuntime();
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
	const [resolvingConflicts, setResolvingConflicts] = useState(false);

	const resolveConflicts = async (
		conflictIds: string[],
		resolution: ConflictResolution,
	) => {
		if (local.status !== "ready" || conflictIds.length === 0) return;
		setResolvingConflicts(true);
		try {
			for (const conflictId of conflictIds) {
				await localMutation(
					local.database,
					local.deviceId,
					"conflicts.resolve",
					{ conflictId, resolution },
				);
			}
			sync.notifyLocalChange();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setResolvingConflicts(false);
		}
	};

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
			{/* Anchored to the shell's content area rather than this centred
			    column: it is a shell control, and the only way back once the
			    sidebar is collapsed. */}
			<div className="absolute left-4 top-4">
				<SidebarOpenButton />
			</div>
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
				<output className="mt-4 block text-sm">{message}</output>
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
				<ConflictInbox
					conflicts={unresolvedConflicts}
					resolving={resolvingConflicts}
					onResolve={(conflictIds, resolution) =>
						void resolveConflicts(conflictIds, resolution)
					}
				/>
			) : null}
		</main>
	);
}
