import type { SyncRuntimeState } from "@contextboard/application";
import { Github, LogOut, RefreshCw, UserRound } from "lucide-react";
import { useState } from "react";
import type { AccountSummary } from "../sidebar/AppSidebar.tsx";
import { Button } from "../ui/button.tsx";
import type { SettingsSection } from "./SettingsDialog.tsx";
import {
	SettingsFact,
	SettingsGroup,
	SettingsMessage,
	SettingsRow,
} from "./SettingsPrimitives.tsx";
import { syncStateLabel } from "./sync-status.ts";

export type AccountSettingsRuntime = {
	state: SyncRuntimeState;
	message?: string;
	account?: AccountSummary;
	workspaceId?: string | null;
	pendingCount?: number;
	conflictCount?: number;
	signIn?: () => Promise<void>;
	signOut?: () => Promise<void>;
	syncNow?: () => Promise<void>;
};

function AccountSettings({ runtime }: { runtime: AccountSettingsRuntime }) {
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const run = (kind: string, action: (() => Promise<void>) | undefined) => {
		if (!action) return;
		setPending(kind);
		setError(null);
		void action()
			.catch((reason: unknown) =>
				setError(reason instanceof Error ? reason.message : String(reason)),
			)
			.finally(() => setPending(null));
	};

	const signedIn = Boolean(runtime.account);
	return (
		<>
			<SettingsRow
				title={
					signedIn
						? (runtime.account?.name ?? runtime.account?.email ?? "Signed in")
						: "Not signed in"
				}
				description={
					signedIn
						? runtime.account?.email
						: "ContextBoard works without an account; signing in syncs this workspace across devices."
				}
				control={
					signedIn ? (
						runtime.signOut ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={pending !== null}
								onClick={() => run("out", runtime.signOut)}
							>
								<LogOut /> Sign out
							</Button>
						) : null
					) : runtime.signIn ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending !== null}
							onClick={() => run("in", runtime.signIn)}
						>
							<Github />
							{pending === "in" ? "Signing in…" : "Sign in with GitHub"}
						</Button>
					) : null
				}
			/>

			<SettingsGroup title="Sync">
				<SettingsFact
					label="Status"
					value={runtime.message ?? syncStateLabel(runtime.state)}
				/>
				{runtime.workspaceId ? (
					<SettingsFact label="Workspace" value={runtime.workspaceId} />
				) : null}
				<SettingsFact
					label="Pending changes"
					value={runtime.pendingCount ?? 0}
				/>
				{runtime.conflictCount ? (
					<SettingsFact
						label="Unresolved conflicts"
						value={runtime.conflictCount}
					/>
				) : null}
				{runtime.syncNow ? (
					<div className="pt-1">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending !== null || runtime.state === "syncing"}
							onClick={() => run("sync", runtime.syncNow)}
						>
							<RefreshCw
								className={
									pending === "sync" || runtime.state === "syncing"
										? "animate-spin"
										: undefined
								}
							/>
							Sync now
						</Button>
					</div>
				) : null}
			</SettingsGroup>

			{error ? (
				<SettingsMessage tone="error" role="alert">
					{error}
				</SettingsMessage>
			) : null}
		</>
	);
}

/** Identity and sync state, which both shells have in the same shape. */
export function accountSettingsSection(
	runtime: AccountSettingsRuntime,
): SettingsSection {
	return {
		id: "account",
		label: "Account",
		icon: UserRound,
		description: "Who this device syncs as, and where its changes stand.",
		content: <AccountSettings runtime={runtime} />,
	};
}
