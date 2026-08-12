import {
	Button,
	SettingsGroup,
	SettingsItem,
	SettingsMessage,
} from "@contextboard/web-ui";
import {
	Check,
	ChevronRight,
	GitMerge,
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

export type LocalWorkspaces = ReturnType<typeof useLocalWorkspaces>;

/**
 * Local workspace directories as the native shell reports them. The list
 * command is treated as optional so an older shell hides the section instead of
 * breaking settings.
 */
export function useLocalWorkspaces() {
	const invoke = useDesktopInvoke();
	const desktop = useDesktopRuntime();
	const [workspaceIds, setWorkspaceIds] = useState<string[] | null>(null);

	useEffect(() => {
		let active = true;
		void invokeDesktop<unknown>("workspace_list_local", {}, invoke)
			.then((value) => {
				if (!active) return;
				setWorkspaceIds(
					Array.isArray(value)
						? value.filter((id): id is string => typeof id === "string")
						: null,
				);
			})
			.catch(() => {
				if (active) setWorkspaceIds(null);
			});
		return () => {
			active = false;
		};
	}, [invoke]);

	const activeWorkspaceId =
		desktop.status === "ready" ? desktop.workspaceId : null;
	const forget = useCallback(
		(workspaceId: string) =>
			setWorkspaceIds(
				(current) => current?.filter((id) => id !== workspaceId) ?? null,
			),
		[],
	);

	return {
		available: workspaceIds !== null && activeWorkspaceId !== null,
		workspaceIds,
		activeWorkspaceId,
		forget,
	};
}

/**
 * Account workspace selection and recovery of local workspaces that were never
 * linked to the account.
 */
export function WorkspaceSection({
	workspaces,
}: {
	workspaces: LocalWorkspaces;
}) {
	const sync = useDesktopSync();
	const { workspaceIds, activeWorkspaceId, forget } = workspaces;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<WorkspaceAction | null>(null);

	const mergeSources = useMemo(
		() =>
			workspaceIds?.filter(
				(workspaceId) => workspaceId !== activeWorkspaceId,
			) ?? [],
		[activeWorkspaceId, workspaceIds],
	);
	const isMergeAction = confirming?.kind === "merge";

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
		if (busy || !confirming) return;
		setBusy(true);
		setError(null);
		try {
			if (confirming.kind === "merge")
				await sync.mergeIntoActiveWorkspace(confirming.workspaceId);
			else await sync.deleteLocalWorkspace(confirming.workspaceId);
			forget(confirming.workspaceId);
			setConfirming(null);
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
		confirming,
		forget,
		sync.deleteLocalWorkspace,
		sync.mergeIntoActiveWorkspace,
	]);

	if (!activeWorkspaceId) return null;

	return (
		<>
			<SettingsGroup title="Account workspaces">
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
			</SettingsGroup>

			<SettingsGroup
				title="Local workspaces on this device"
				description="These are local recovery copies. Merge uploads their current data and removes the copy after sync. Delete discards it without uploading."
			>
				{mergeSources.length ? (
					<div className="space-y-1">
						{mergeSources.map((workspaceId) => (
							<SettingsItem key={workspaceId}>
								{/* A workspace id is long and unbreakable, so it claims a
								    minimum width and takes its own line when the actions
								    would otherwise squeeze it away. */}
								<span className="min-w-0 flex-1 basis-40 truncate font-mono text-xs">
									{workspaceId}
								</span>
								<Button
									type="button"
									variant="outline"
									size="xs"
									disabled={busy}
									onClick={() => setConfirming({ workspaceId, kind: "merge" })}
								>
									<GitMerge /> Merge and delete
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									disabled={busy}
									onClick={() => setConfirming({ workspaceId, kind: "delete" })}
								>
									<Trash2 /> Delete local copy
								</Button>
							</SettingsItem>
						))}
					</div>
				) : (
					<p className="text-xs text-[var(--muted-foreground)]">
						No stranded local workspaces found.
					</p>
				)}
			</SettingsGroup>

			{confirming ? (
				<SettingsMessage tone="warning">
					<p className="font-medium">
						{isMergeAction
							? "Merge and delete local workspace?"
							: "Delete local workspace?"}
					</p>
					<p className="mt-1 text-[var(--muted-foreground)]">
						{isMergeAction ? (
							<>
								Copy <span className="font-mono">{confirming.workspaceId}</span>{" "}
								into <span className="font-mono">{activeWorkspaceId}</span>,
								sync it, and delete the local source copy only after successful
								sync. If sync fails, the source is kept.
							</>
						) : (
							<>
								Permanently delete all local entities and pending changes in{" "}
								<span className="font-mono">{confirming.workspaceId}</span>?
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
							onClick={() => setConfirming(null)}
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
				</SettingsMessage>
			) : null}

			{error ? (
				<SettingsMessage tone="error" role="alert">
					{error}
				</SettingsMessage>
			) : null}
		</>
	);
}
