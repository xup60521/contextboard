import {
	accountSettingsSection,
	appearanceSettingsSection,
	Dialog,
	DialogTrigger,
	SettingsDialogContent,
	type SettingsSection,
	SettingsTriggerButton,
} from "@contextboard/web-ui";
import { Bot, HardDrive, Info } from "lucide-react";
import { useState } from "react";
import { useDesktopRuntime } from "../runtime/DesktopRuntimeProvider";
import { useDesktopSync } from "../runtime/DesktopSyncProvider";
import { AboutSection } from "./AboutSection";
import { AgentBridgeSection, useAgentBridge } from "./AgentBridgeSection";
import { useLocalWorkspaces, WorkspaceSection } from "./WorkspaceSection";

/**
 * Desktop settings.
 *
 * A dialog rather than a route so settings never cost the user their place on a
 * whiteboard. The shell, navigation and controls come from the shared settings
 * kit; this file only decides which sections this platform actually has.
 */
export function DesktopSettingsDialog() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<SettingsTriggerButton />
			</DialogTrigger>
			{/* Sections probe the native shell when they mount, so they are only
			    built while settings are actually open. */}
			{open ? <DesktopSettingsSections /> : null}
		</Dialog>
	);
}

function DesktopSettingsSections() {
	const desktop = useDesktopRuntime();
	const sync = useDesktopSync();
	const bridge = useAgentBridge();
	const workspaces = useLocalWorkspaces();
	const signedIn = sync.account !== null;

	const sections: SettingsSection[] = [
		appearanceSettingsSection,
		accountSettingsSection({
			state: sync.state,
			message: sync.message,
			// Signed out, the desktop still has a working local-only workspace, so
			// name it rather than presenting an empty account.
			account: signedIn
				? { name: sync.account?.name, email: sync.account?.email }
				: undefined,
			workspaceId: desktop.status === "ready" ? desktop.workspaceId : null,
			pendingCount: sync.pendingCount,
			signIn: signedIn ? undefined : sync.signIn,
			signOut: signedIn ? sync.signOut : undefined,
			syncNow: signedIn ? sync.syncNow : undefined,
		}),
	];

	// An older shell without these commands hides the section rather than
	// showing a control that cannot work.
	if (workspaces.available)
		sections.push({
			id: "workspaces",
			label: "Workspaces",
			icon: HardDrive,
			description: "Choose where this desktop keeps its active board.",
			content: <WorkspaceSection workspaces={workspaces} />,
		});

	if (bridge.status)
		sections.push({
			id: "agent",
			label: "AI agent access",
			icon: Bot,
			description: "Let a local agent on this computer use your workspace.",
			content: <AgentBridgeSection bridge={bridge} />,
		});

	sections.push({
		id: "about",
		label: "About",
		icon: Info,
		description: "This build of ContextBoard Desktop.",
		content: <AboutSection />,
	});

	return (
		<SettingsDialogContent
			sections={sections}
			description="Preferences for this computer and its workspace."
		/>
	);
}
