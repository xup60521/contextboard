import { Button } from "@contextboard/web-ui";
import {
	Check,
	ChevronRight,
	GitMerge,
	HardDrive,
	LoaderCircle,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	useDesktopInvoke,
	useDesktopRuntime,
} from "../runtime/DesktopRuntimeProvider";
import { useDesktopSync } from "../runtime/DesktopSyncProvider";
import { invokeDesktop } from "../runtime/repository";

type WorkspaceAction = {
	workspaceId: string;
	kind: "merge" | "delete";
};

/**
 * Account workspace selection and recovery of local workspaces that were not
 * linked to the account. The native list command is intentionally treated as
 * optional so an older shell can hide this section without breaking settings.
 */
export function WorkspaceSection() {
	const invoke = useDesktopInvoke();
	const desktop = useDesktopRuntime();
	const sync = useDesktopSync();
	const [status, setStatus] = useState<string[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingAction, setConfirmingAction] =
		useState<WorkspaceAction | null>(null);

	useEffect(() => {
		let active = true;
		void invokeDesktop<unknown>("workspace_list_local", {}, invoke)
			.then((value) => {
				if (!active) return;
				if (!Array.isArray(value)) {
					setStatus(null);
					return;
				}
				setStatus(value.filter((id): id is string => typeof id === "string"));
			})
			.catch(() => {
				// An older shell without the command simply hides the section.
				if (active) setStatus(null);
			});
		return () => {
			active = false;
		};
	}, [invoke]);

	const activeWorkspaceId =
		desktop.status === "ready" ? desktop.workspaceId : null;
	const mergeSources = useMemo(
		() =>
			status?.filter((workspaceId) => workspaceId !== activeWorkspaceId) ?? [],
		[activeWorkspaceId, status],
	);
	const confirmingWorkspace = confirmingAction?.workspaceId ?? null;
	const isMergeAction = confirmingAction?.kind === "merge";

	const switchWorkspace = useCallback(
		async (workspaceId: string) => {
			if (busy || workspaceId === activeWorkspaceId) return;
			setBusy(true);
			setError(null);
			try {
				await sync.switchWorkspace(workspaceId);
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "The workspace could not be selected.",
				);
			} finally {
				setBusy(false);
			}
		},
		[activeWorkspaceId, busy, sync.switchWorkspace],
	);

	const confirmAction = useCallback(async () => {
		if (busy || !confirmingAction) return;
		setBusy(true);
		setError(null);
		try {
			if (confirmingAction.kind === "merge")
				await sync.mergeIntoActiveWorkspace(confirmingAction.workspaceId);
			else await sync.deleteLocalWorkspace(confirmingAction.workspaceId);
			setStatus(
				(current) =>
					current?.filter((id) => id !== confirmingAction.workspaceId) ?? null,
			);
			setConfirmingAction(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The local workspace action could not be completed.",
			);
		} finally {
			setBusy(false);
		}
	}, [
		busy,
		confirmingAction,
		sync.deleteLocalWorkspace,
		sync.mergeIntoActiveWorkspace,
	]);

	if (!status || !activeWorkspaceId) return null;

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-md border border-[var(--border)] p-1.5 text-[var(--muted-foreground)]">
					<HardDrive className="size-3.5" />
				</div>
				<div className="min-w-0">
					<h3 className="text-sm font-medium">Workspaces</h3>
					<p className="text-xs text-[var(--muted-foreground)]">
						Choose where this desktop keeps its active board.
					</p>
				</div>
			</div>

			<div className="space-y-2">
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
					Account workspaces
				</p>
				{sync.account ? (
					sync.workspaces.length ? (
						<div className="space-y-1">
							{sync.workspaces.map((workspace) => {
								const active = workspace.workspaceId === activeWorkspaceId;
								return (
									<Button
										key={workspace.workspaceId}
										type="button"
										variant={active ? "secondary" : "outline"}
										size="sm"
										className="w-full justify-between"
										disabled={busy}
										onClick={() => void switchWorkspace(workspace.workspaceId)}
										aria-pressed={active}
									>
										<span className="min-w-0 truncate font-mono text-xs">
											{workspace.workspaceId}
										</span>
										{active ? (
											<span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
												<Check className="size-3" /> Active
											</span>
										) : (
											<ChevronRight className="size-3.5 text-[var(--muted-foreground)]" />
										)}
									</Button>
								);
							})}
						</div>
					) : (
						<p className="text-xs text-[var(--muted-foreground)]">
							No account workspaces are available yet.
						</p>
					)
				) : (
					<p className="text-xs text-[var(--muted-foreground)]">
						Sign in to see and switch between your account workspaces.
					</p>
				)}
			</div>

			<div className="space-y-2 border-t border-[var(--border)] pt-3">
				<div>
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
						Local workspaces on this device
					</p>
					<p className="mt-1 text-xs text-[var(--muted-foreground)]">
						These are local recovery copies. Merge uploads their current data
						and removes the copy after sync. Delete discards it without
						uploading.
					</p>
				</div>
				{mergeSources.length ? (
					<div className="space-y-1">
						{mergeSources.map((workspaceId) => (
							<div
								key={workspaceId}
								className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2 py-1.5"
							>
								<span className="min-w-0 flex-1 truncate font-mono text-xs">
									{workspaceId}
								</span>
								<Button
									type="button"
									variant="outline"
									size="xs"
									disabled={busy}
									onClick={() =>
										setConfirmingAction({ workspaceId, kind: "merge" })
									}
								>
									<GitMerge /> Merge and delete
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									disabled={busy}
									onClick={() =>
										setConfirmingAction({ workspaceId, kind: "delete" })
									}
								>
									<Trash2 /> Delete local copy
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="text-xs text-[var(--muted-foreground)]">
						No stranded local workspaces found.
					</p>
				)}
			</div>

			{confirmingWorkspace ? (
				<div className="rounded-md border border-amber-300/70 bg-amber-50/70 p-3 text-xs dark:border-amber-700/60 dark:bg-amber-950/20">
					<p className="font-medium">
						{isMergeAction
							? "Merge and delete local workspace?"
							: "Delete local workspace?"}
					</p>
					<p className="mt-1 text-[var(--muted-foreground)]">
						{isMergeAction ? (
							<>
								Copy <span className="font-mono">{confirmingWorkspace}</span>{" "}
								into <span className="font-mono">{activeWorkspaceId}</span>,
								sync it, and delete the local source copy only after successful
								sync. If sync fails, the source is kept.
							</>
						) : (
							<>
								Permanently delete all local entities and pending changes in{" "}
								<span className="font-mono">{confirmingWorkspace}</span>?
								Nothing will be uploaded or merged. Any matching account
								workspace remains on the server. This cannot be undone.
							</>
						)}
					</p>
					<div className="mt-2 flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => setConfirmingAction(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="default"
							size="sm"
							disabled={busy}
							onClick={() => void confirmAction()}
						>
							{busy ? <LoaderCircle className="animate-spin" /> : null}
							{isMergeAction ? "Merge and delete" : "Delete local workspace"}
						</Button>
					</div>
				</div>
			) : null}

			{error ? (
				<p className="text-xs text-red-600 dark:text-red-400" role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
