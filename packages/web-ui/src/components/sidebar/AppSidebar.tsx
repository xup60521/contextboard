import type { SyncRuntimeState } from "@contextboard/application";
import { Cloud, CloudOff, Github, LogOut, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
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
	/**
	 * Platform-specific settings entry point, rendered beside the account row.
	 * The desktop shell has local settings (the agent bridge) that the web build
	 * has no equivalent for, so the slot stays empty rather than the shared
	 * footer knowing about them.
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
	const isDisconnected =
		runtime.state === "local-only" ||
		runtime.state === "offline" ||
		runtime.state === "error" ||
		runtime.state === "unavailable";
	const StatusIcon = isDisconnected ? CloudOff : Cloud;
	const account =
		runtime.account ??
		(!runtime.signIn ? { name: "Desktop", email: null } : undefined);
	const isBusy = pending === "sync" || runtime.state === "syncing";
	const label =
		runtime.message ??
		(
			{
				idle: "Up to date",
				syncing: "Syncing",
				offline: "Offline",
				"local-only": "Local only",
				error: "Sync error",
				unavailable: "Sync unavailable",
			} satisfies Record<SyncRuntimeState, string>
		)[runtime.state];

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
							<a
								href={runtime.conflictHref}
								className="text-[10px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
							>
								Open conflict inbox
							</a>
						) : null}
						{runtime.createWorkspace && runtime.workspaceSelectionRequired ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-1 w-full justify-start text-[10px]"
								disabled={pending !== null}
								onClick={() => run("sync", runtime.createWorkspace)}
							>
								Create separate workspace
							</Button>
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
