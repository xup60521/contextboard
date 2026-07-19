import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	exportLocalArchive,
	importArchive,
} from "#/integrations/local/archive";
import { useLocalDatabase } from "#/integrations/local/provider";

export const Route = createFileRoute("/data")({
	ssr: false,
	component: DataManagementPage,
});

function DataManagementPage() {
	const local = useLocalDatabase();
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
			<p className="mt-10 text-xs text-[var(--text-muted)]">
				Synchronization is not configured. The reserved sync protocol performs
				no network requests.
			</p>
		</main>
	);
}
