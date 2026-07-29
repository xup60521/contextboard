import type { SyncRuntimeState } from "@contextboard/application";
import { Cloud, CloudOff, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AppSidebarFrame } from "../whiteboard/AppSidebarFrame";
import { Button } from "../ui/button";
import { SidebarTabs } from "./SidebarTabs";

export type AccountSummary = {
	name?: string | null;
	email?: string | null;
};

export type SidebarFooterRuntime = {
	state: SyncRuntimeState;
	message?: string;
	account?: AccountSummary;
	signIn?: () => Promise<void>;
	signOut?: () => Promise<void>;
	syncNow?: () => Promise<void>;
};

export function AppSidebar({
	pathname,
	footer,
}: {
	pathname: string;
	footer: SidebarFooterRuntime;
}) {
	return (
		<AppSidebarFrame footer={<SidebarFooter runtime={footer} />}>
			<SidebarTabs pathname={pathname} />
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
	const label =
		runtime.message ??
		({
			idle: "Up to date",
			syncing: "Syncing",
			offline: "Offline",
			"local-only": "Local only",
			error: "Sync error",
			unavailable: "Sync unavailable",
		} satisfies Record<SyncRuntimeState, string>)[runtime.state];

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
			{runtime.account ? (
				<div className="flex items-center gap-2 rounded-md px-2 py-1.5">
					<StatusIcon className="size-3.5 text-[var(--muted-foreground)]" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-medium">
							{runtime.account.name || runtime.account.email || "Account"}
						</p>
						<p
							className="truncate text-[10px] text-[var(--muted-foreground)]"
							title={error ?? undefined}
						>
							{error ?? label}
						</p>
					</div>
					{runtime.syncNow ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							disabled={pending !== null || runtime.state === "syncing"}
							onClick={() => run("sync", runtime.syncNow)}
							aria-label="Sync now"
						>
							<RefreshCw
								className={
									pending === "sync" || runtime.state === "syncing"
										? "animate-spin"
										: undefined
								}
							/>
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
					<Button
						type="button"
						variant="outline"
						className="w-full justify-start"
						disabled={pending !== null}
						onClick={() => run("in", runtime.signIn)}
					>
						<LogIn />
						{pending === "in" ? "Signing in…" : "Sign in"}
					</Button>
					{error ? (
						<p className="px-1 text-[10px] text-destructive" title={error}>
							{error}
						</p>
					) : null}
				</div>
			) : (
				<div className="flex items-center gap-2 rounded-md px-2 py-1.5">
					<StatusIcon className="size-3.5 text-[var(--muted-foreground)]" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-medium">Desktop</p>
						<p className="truncate text-[10px] text-[var(--muted-foreground)]">
							{label}
						</p>
					</div>
				</div>
			)}
		</footer>
	);
}
