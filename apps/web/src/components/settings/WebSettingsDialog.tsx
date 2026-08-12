import {
	signInWithGitHubPopup,
	signOut,
	useSession,
} from "@contextboard/auth-client";
import {
	accountSettingsSection,
	appearanceSettingsSection,
	Dialog,
	DialogClose,
	DialogTrigger,
	SettingsDialogContent,
	SettingsGroup,
	SettingsRow,
	type SettingsSection,
	SettingsTriggerButton,
} from "@contextboard/web-ui";
import { Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import type { ReactNode } from "react";
import { useSyncRuntime } from "#/integrations/sync/provider";

/**
 * Web settings.
 *
 * The same dialog the desktop shell opens, assembled from the sections the web
 * build actually has: everything device-local lives here, and anything that
 * needs a full page is linked rather than reimplemented in a dialog.
 */
export function WebSettingsDialog() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<SettingsTriggerButton />
			</DialogTrigger>
			<WebSettingsSections />
		</Dialog>
	);
}

function WebSettingsSections() {
	const session = useSession();
	const sync = useSyncRuntime();
	const user = session.data?.user;

	const sections: SettingsSection[] = [
		appearanceSettingsSection,
		accountSettingsSection({
			state: sync.state.state,
			message: sync.state.error,
			account: user ? { name: user.name, email: user.email } : undefined,
			workspaceId: sync.state.workspaceId,
			pendingCount: sync.state.pendingCount,
			conflictCount: sync.state.conflictCount,
			signIn: user
				? undefined
				: async () => {
						await signInWithGitHubPopup();
						await session.refetch();
					},
			signOut: user
				? async () => {
						await signOut();
					}
				: undefined,
			syncNow: sync.syncNow,
		}),
		{
			id: "data",
			label: "Data",
			icon: Database,
			description: "Where your boards live and who else may reach them.",
			content: <DataSettings conflictCount={sync.state.conflictCount} />,
		},
	];

	return (
		<SettingsDialogContent
			sections={sections}
			description="Preferences for this browser and its workspace."
		/>
	);
}

function DataSettings({ conflictCount }: { conflictCount: number }) {
	return (
		<SettingsGroup>
			<SettingsRow
				title="Local data"
				description="Export or import an archive of this workspace, and resolve sync conflicts."
				control={
					<SettingsLink to="/data">
						{conflictCount ? `Open (${conflictCount} conflicts)` : "Open"}
					</SettingsLink>
				}
			/>
			<SettingsRow
				title="Agent tokens"
				description="Issue and revoke tokens that let an agent use this account's workspace."
				control={<SettingsLink to="/agent-tokens">Manage</SettingsLink>}
			/>
		</SettingsGroup>
	);
}

/** Navigating away from a dialog must also close it, or it outlives its page. */
function SettingsLink({ to, children }: { to: string; children: ReactNode }) {
	return (
		<DialogClose asChild>
			<Link
				to={to}
				className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
			>
				{children}
			</Link>
		</DialogClose>
	);
}
