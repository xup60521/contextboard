import type { ConflictRecord } from "@contextboard/sync-protocol";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";

export type ConflictResolution = "keep-local" | "keep-remote" | "keep-both";

const resolutionLabels: Record<ConflictResolution, string> = {
	"keep-local": "Keep local",
	"keep-remote": "Keep remote",
	"keep-both": "Keep both",
};

export function ConflictInbox({
	conflicts,
	resolving,
	onResolve,
}: {
	conflicts: ConflictRecord[];
	resolving: boolean;
	onResolve: (conflictIds: string[], resolution: ConflictResolution) => void;
}) {
	const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>([]);
	const conflictIdKey = conflicts
		.map((conflict) => conflict.conflictId)
		.join("\0");
	const selectedVisibleConflictIds = selectedConflictIds.filter((conflictId) =>
		conflicts.some((conflict) => conflict.conflictId === conflictId),
	);
	const allSelected =
		conflicts.length > 0 &&
		selectedVisibleConflictIds.length === conflicts.length;

	useEffect(() => {
		const visibleConflictIds = new Set(
			conflictIdKey ? conflictIdKey.split("\0") : [],
		);
		setSelectedConflictIds((current) => {
			const next = current.filter((conflictId) =>
				visibleConflictIds.has(conflictId),
			);
			return next.length === current.length ? current : next;
		});
	}, [conflictIdKey]);

	const toggleConflict = (conflictId: string) => {
		setSelectedConflictIds((current) =>
			current.includes(conflictId)
				? current.filter((id) => id !== conflictId)
				: [...current, conflictId],
		);
	};

	const toggleAll = () => {
		setSelectedConflictIds(
			allSelected ? [] : conflicts.map((conflict) => conflict.conflictId),
		);
	};

	const resolveSelected = (resolution: ConflictResolution) => {
		if (selectedVisibleConflictIds.length === 0) return;
		onResolve(selectedVisibleConflictIds, resolution);
	};

	return (
		<section
			id="conflicts"
			className="mt-6 scroll-mt-6 rounded-lg border border-amber-500/40 p-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-sm font-semibold">
					Conflicts ({conflicts.length})
				</h2>
				<label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-muted)]">
					<input
						type="checkbox"
						checked={allSelected}
						onChange={toggleAll}
						disabled={resolving}
						aria-label={
							allSelected ? "Deselect all conflicts" : "Select all conflicts"
						}
						className="size-4 accent-amber-600"
					/>
					{allSelected ? "Deselect all" : "Select all"}
				</label>
			</div>

			{selectedVisibleConflictIds.length > 0 ? (
				<div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-50/60 p-2 dark:bg-amber-950/20">
					<span className="mr-1 text-xs font-medium">
						{selectedVisibleConflictIds.length} selected
					</span>
					{(Object.keys(resolutionLabels) as ConflictResolution[]).map(
						(resolution) => (
							<Button
								key={resolution}
								type="button"
								size="sm"
								variant="outline"
								disabled={resolving}
								aria-label={`${resolutionLabels[resolution]} selected conflicts`}
								onClick={() => resolveSelected(resolution)}
							>
								{resolutionLabels[resolution]}
							</Button>
						),
					)}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={resolving}
						onClick={() => setSelectedConflictIds([])}
					>
						Clear selection
					</Button>
				</div>
			) : null}

			<div className="mt-3 space-y-3">
				{conflicts.map((conflict) => {
					const selected = selectedVisibleConflictIds.includes(
						conflict.conflictId,
					);
					return (
						<article
							key={conflict.conflictId}
							className={`rounded-md bg-[var(--muted)]/40 p-3 text-xs ${selected ? "ring-1 ring-amber-500/60" : ""}`}
						>
							<div className="flex items-start gap-3">
								<input
									type="checkbox"
									checked={selected}
									onChange={() => toggleConflict(conflict.conflictId)}
									disabled={resolving}
									aria-label={`Select conflict ${conflict.conflictId}`}
									className="mt-0.5 size-4 shrink-0 accent-amber-600"
								/>
								<div className="min-w-0 flex-1">
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
										{(
											Object.keys(resolutionLabels) as ConflictResolution[]
										).map((resolution) => (
											<Button
												key={resolution}
												type="button"
												size="sm"
												variant="outline"
												disabled={resolving}
												onClick={() =>
													onResolve([conflict.conflictId], resolution)
												}
											>
												{resolutionLabels[resolution]}
											</Button>
										))}
									</div>
								</div>
							</div>
						</article>
					);
				})}
			</div>
		</section>
	);
}
