import type { SyncRuntimeState } from "@contextboard/application";
import { AlertTriangle, Github, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AppLink } from "../navigation/AppLink";
import { isDisconnected, syncStateLabel } from "../settings/sync-status";
import { Button } from "../ui/button";
import { AppSidebarFrame } from "../whiteboard/AppSidebarFrame";
import { SidebarTabs } from "./SidebarTabs";
import { sidebarControlClass } from "./sidebar-row";

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

/** One dot carries the sync state, so the status line can stay plain words. */
const statusDotClass = (state: SyncRuntimeState) =>
	state === "syncing"
		? "bg-[var(--ring)] animate-pulse"
		: state === "error"
			? "bg-destructive"
			: isDisconnected(state)
				? "bg-[var(--muted-foreground)]"
				: "bg-emerald-500";

const initialsOf = (account: AccountSummary) => {
	const source = account.name?.trim() || account.email?.trim() || "?";
	const [first, second] = source.split(/[\s@._-]+/).filter(Boolean);
	return ((first?.[0] ?? "?") + (second?.[0] ?? "")).toUpperCase();
};

function SidebarFooter({ runtime }: { runtime: SidebarFooterRuntime }) {
	const [pending, setPending] = useState<"in" | "out" | "sync" | null>(null);
	const [error, setError] = useState<string | null>(null);
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
		<footer className="mt-auto shrink-0 border-t border-[var(--sidebar-border)] p-2">
			{account ? (
				<div className="flex flex-col gap-1.5">
					<div className="group flex items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-[var(--sidebar-row-hover)]">
						<span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-row-active)] text-[10px] font-semibold text-[var(--sidebar-foreground)]">
							{initialsOf(account)}
							<span
								className={`absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-[var(--sidebar)] ${statusDotClass(runtime.state)}`}
								title={label}
							/>
						</span>

						<div className="min-w-0 flex-1">
							<p className="truncate text-xs font-medium leading-4">
								{account.name || account.email || "Account"}
							</p>
							<p
								className="truncate text-[11px] leading-4 text-[var(--muted-foreground)] group-hover:text-[var(--sidebar-foreground)]"
								title={error ?? runtime.message}
							>
								{error ?? label}
								{runtime.pendingCount
									? ` · ${runtime.pendingCount} pending`
									: ""}
							</p>
						</div>

						<div className="flex shrink-0 items-center">
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
							{runtime.settings}
						</div>
					</div>

					{runtime.conflictCount && runtime.conflictHref ? (
						<AppLink
							href={runtime.conflictHref}
							className="flex items-center gap-1.5 rounded-md border border-amber-600/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:border-amber-300/30 dark:text-amber-300 dark:hover:bg-amber-300/15"
						>
							<AlertTriangle className="size-3 shrink-0" />
							{runtime.conflictCount} conflict
							{runtime.conflictCount === 1 ? "" : "s"}
						</AppLink>
					) : null}

					{runtime.createWorkspace && runtime.workspaceSelectionRequired ? (
						<div className="flex flex-col gap-1 rounded-md border border-[var(--border)] p-1.5">
							{runtime.switchWorkspace && runtime.workspaces?.length ? (
								<>
									<p className="px-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">
										Choose a workspace
									</p>
									{runtime.workspaces.map((workspace) => (
										<Button
											key={workspace.workspaceId}
											type="button"
											variant="ghost"
											size="sm"
											className="h-7 w-full justify-start truncate px-1.5 text-[11px]"
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
								</>
							) : null}
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 w-full justify-center text-[11px]"
								disabled={pending !== null}
								onClick={() => run("sync", runtime.createWorkspace)}
							>
								Create separate workspace
							</Button>
						</div>
					) : null}
				</div>
			) : runtime.signIn ? (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className={`min-w-0 flex-1 justify-center text-xs ${sidebarControlClass}`}
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
						<p className="px-1 text-[11px] text-destructive" title={error}>
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</footer>
	);
}
