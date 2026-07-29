import {
	signInWithGitHubPopup,
	signOut,
	useSession,
} from "@contextboard/auth-client";
import { Link } from "@tanstack/react-router";
import {
	Cloud,
	CloudOff,
	Github,
	LogOut,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { SidebarTabs } from "#/components/sidebar/SidebarTabs";
import { Button } from "#/components/ui/button";
import { useSyncRuntime } from "../../integrations/sync/provider";
import { AppSidebarFrame } from "./AppSidebarFrame";

export function AppSidebar() {
	return (
		<AppSidebarFrame footer={<SyncFooter />}>
			<SidebarTabs />
		</AppSidebarFrame>
	);
}

function SyncFooter() {
	const session = useSession();
	const sync = useSyncRuntime();
	const [loginPending, setLoginPending] = useState(false);
	const [loginError, setLoginError] = useState<string | null>(null);
	const isBusy = sync.state.state === "syncing";
	const label =
		sync.state.state === "local-only"
			? "Local only"
			: sync.state.state === "syncing"
				? "Syncing"
				: sync.state.state === "error"
					? "Sync error"
					: "Up to date";
	const StatusIcon =
		sync.state.state === "local-only" || sync.state.state === "error"
			? CloudOff
			: Cloud;

	return (
		<footer className="mt-auto border-t border-[var(--border)] p-2">
			{session.data?.user ? (
				<div className="flex items-center gap-2 rounded-md px-2 py-1.5">
					<StatusIcon className="size-3.5 text-[var(--muted-foreground)]" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-medium">
							{session.data.user.name || session.data.user.email}
						</p>
						<p
							className="truncate text-[10px] text-[var(--muted-foreground)]"
							title={sync.state.error}
						>
							{label}
							{sync.state.pendingCount
								? ` · ${sync.state.pendingCount} pending`
								: ""}
							{sync.state.conflictCount
								? ` · ${sync.state.conflictCount} conflicts`
								: ""}
						</p>
						{sync.state.conflictCount ? (
							<Link
								to="/data"
								hash="conflicts"
								className="text-[10px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
							>
								Open conflict inbox
							</Link>
						) : null}
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						disabled={isBusy}
						onClick={() => void sync.syncNow()}
						aria-label="Sync now"
					>
						<RefreshCw className={isBusy ? "animate-spin" : undefined} />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => void signOut()}
						aria-label="Sign out"
					>
						<LogOut />
					</Button>
				</div>
			) : (
				<div className="space-y-1">
					<Button
						type="button"
						variant="outline"
						className="w-full justify-start"
						disabled={sync.sessionPending || loginPending}
						onClick={() => {
							setLoginPending(true);
							setLoginError(null);
							void signInWithGitHubPopup()
								.then(() => session.refetch())
								.catch((error: unknown) => {
									setLoginError(
										error instanceof Error ? error.message : String(error),
									);
								})
								.finally(() => setLoginPending(false));
						}}
					>
						<Github />
						{loginPending ? "Signing in…" : "Sign in with GitHub"}
					</Button>
					{loginError ? (
						<p className="px-1 text-[10px] text-destructive" title={loginError}>
							{loginError}
						</p>
					) : null}
				</div>
			)}
		</footer>
	);
}
