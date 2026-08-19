import type { SyncRuntimeState } from "@contextboard/application";
import { Cloud, CloudOff, Github, LogOut, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AppLink } from "../navigation/AppLink";
import { isDisconnected, syncStateLabel } from "../settings/sync-status";
import { Button } from "../ui/button";
import { AppSidebarFrame } from "../whiteboard/AppSidebarFrame";
import { SidebarTabs } from "./SidebarTabs";

export type AccountSummary = {
	name?: string | null;
	email?: string | null;
};

export type SidebarFooterRuntime = {
	state: SyncRuntimeState;
	message?: string;
	account?: AccountSummary;
	pendingCount?: number;
	conflictCount?: number;
	conflictHref?: string;
	signIn?: () => Promise<void>;
	signOut?: () => Promise<void>;
	syncNow?: () => Promise<void>;
	createWorkspace?: () => Promise<void>;
	workspaceSelectionRequired?: boolean;
	workspaces?: ReadonlyArray<{ workspaceId: string }>;
	switchWorkspace?: (workspaceId: string) => Promise<void>;
	/**
	 * The platform's settings dialog, rendered beside the account row. Both
	 * shells fill this slot; they differ only in which sections they assemble,
	 * so the footer never learns what a given platform can configure.
	 */
	settings?: ReactNode;
};

export function AppSidebar({ footer }: { footer: SidebarFooterRuntime }) {
	return (
		<AppSidebarFrame footer={<SidebarFooter runtime={footer} />}>
			<SidebarTabs />
		</AppSidebarFrame>
	);
}

function SidebarFooter({ runtime }: { runtime: SidebarFooterRuntime }) {
	const [pending, setPending] = useState<"in" | "out" | "sync" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const StatusIcon = isDisconnected(runtime.state) ? CloudOff : Cloud;
	const account =
		runtime.account ??
		(!runtime.signIn ? { name: "Desktop", email: null } : undefined);
	const isBusy = pending === "sync" || runtime.state === "syncing";
	const label = runtime.message ?? syncStateLabel(runtime.state);

	const run = (
		kind: "in" | "out" | "sync",
		action: (() => Promise<void>) | undefined,
	) => {
		if (!action) return;
		setPending(kind);
		setError(null);
		void action()
			.catch((reason: unknown) =>
				setError(reason instanceof Error ? reason.message : String(reason)),
			)
			.finally(() => setPending(null));
	};

	return (
		<footer className="mt-auto border-t border-[var(--border)] p-2">
			{account ? (
				<div className="flex items-center gap-2 rounded-md px-2 py-1.5">
					<StatusIcon className="size-3.5 text-[var(--muted-foreground)]" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-medium">
							{account.name || account.email || "Account"}
						</p>
						<p
							className="truncate text-[10px] text-[var(--muted-foreground)]"
							title={error ?? runtime.message}
						>
							{error ?? label}
							{runtime.pendingCount ? ` · ${runtime.pendingCount} pending` : ""}
							{runtime.conflictCount
								? ` · ${runtime.conflictCount} conflicts`
								: ""}
						</p>
						{runtime.conflictCount && runtime.conflictHref ? (
							<AppLink
								href={runtime.conflictHref}
								className="text-[10px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
							>
								Open conflict inbox
							</AppLink>
						) : null}
						{runtime.createWorkspace && runtime.workspaceSelectionRequired ? (
							<div className="mt-1 space-y-1">
								{runtime.switchWorkspace && runtime.workspaces?.length ? (
									<div className="space-y-0.5">
										<p className="px-1 text-[10px] text-[var(--muted-foreground)]">
											Choose an account workspace
										</p>
										{runtime.workspaces.map((workspace) => (
											<Button
												key={workspace.workspaceId}
												type="button"
												variant="ghost"
												size="sm"
												className="h-7 w-full justify-start truncate px-1.5 text-[10px]"
												disabled={pending !== null}
												onClick={() =>
													run("sync", () =>
														runtime.switchWorkspace!(workspace.workspaceId),
													)
												}
											>
												{workspace.workspaceId}
											</Button>
										))}
									</div>
								) : null}
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="w-full justify-start text-[10px]"
									disabled={pending !== null}
									onClick={() => run("sync", runtime.createWorkspace)}
								>
									Create separate workspace
								</Button>
							</div>
						) : null}
					</div>
					{runtime.settings}
					{runtime.syncNow ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							disabled={pending !== null || isBusy}
							onClick={() => run("sync", runtime.syncNow)}
							aria-label="Sync now"
						>
							<RefreshCw className={isBusy ? "animate-spin" : undefined} />
						</Button>
					) : null}
					{runtime.signOut ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							disabled={pending !== null}
							onClick={() => run("out", runtime.signOut)}
							aria-label="Sign out"
						>
							<LogOut />
						</Button>
					) : null}
				</div>
			) : runtime.signIn ? (
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="outline"
							className="min-w-0 flex-1 justify-start"
							disabled={pending !== null}
							onClick={() => run("in", runtime.signIn)}
						>
							<Github />
							{pending === "in" ? "Signing in…" : "Sign in with GitHub"}
						</Button>
						{/* Settings must stay reachable signed out: local-only is a
						    supported way to use the app, not a degraded state. */}
						{runtime.settings}
					</div>
					{error ? (
						<p className="px-1 text-[10px] text-destructive" title={error}>
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</footer>
	);
}
