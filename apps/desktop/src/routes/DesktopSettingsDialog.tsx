import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@contextboard/web-ui";
import { Settings } from "lucide-react";
import { useState } from "react";
import { AgentBridgeSection } from "./AgentBridgeSection";
import { WorkspaceSection } from "./WorkspaceSection";

/**
 * Desktop settings.
 *
 * A dialog rather than a route so settings never cost the user their place on a
 * whiteboard, and a section list rather than a single control so the next
 * setting has somewhere to go.
 */
export function DesktopSettingsDialog() {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Settings"
				>
					<Settings />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>
						Preferences for this computer and its workspace.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-6">
					<WorkspaceSection />
					<AgentBridgeSection />
				</div>
			</DialogContent>
		</Dialog>
	);
}
