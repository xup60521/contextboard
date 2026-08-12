import { type LucideIcon, Settings } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import {
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../ui/dialog.tsx";

/**
 * One entry in the settings dialog: a nav item and the pane it reveals.
 *
 * Platforms assemble their own list — the shell owns the frame, the navigation,
 * and the typography, so a desktop-only setting cannot invent its own layout.
 */
export type SettingsSection = {
	id: string;
	label: string;
	icon: LucideIcon;
	/** Shown under the pane heading; the one-line answer to "what is this for". */
	description?: string;
	content: ReactNode;
};

/**
 * The settings affordance itself, so every shell opens settings the same way.
 * Props are forwarded because this is what `DialogTrigger asChild` hands its
 * open handler to.
 */
export function SettingsTriggerButton(props: ComponentProps<typeof Button>) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label="Settings"
			{...props}
		>
			<Settings />
		</Button>
	);
}

export function SettingsDialogContent({
	sections,
	description = "Preferences for ContextBoard.",
}: {
	sections: SettingsSection[];
	description?: string;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const active =
		sections.find((section) => section.id === selectedId) ?? sections[0];

	// The width is capped against the viewport as well: `sm:max-w-*` alone would
	// override the base cap and run off the edge of a narrow desktop window.
	return (
		<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[min(42rem,calc(100vw-2rem))]">
			<div className="flex h-[26rem] max-h-[75vh]">
				<nav
					aria-label="Settings sections"
					className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-[var(--border)] bg-[var(--card)] p-2"
				>
					<div className="px-2 pt-1 pb-2">
						<DialogTitle className="text-sm">Settings</DialogTitle>
						<DialogDescription className="sr-only">
							{description}
						</DialogDescription>
					</div>
					{sections.map((section) => {
						const Icon = section.icon;
						const isActive = section.id === active?.id;
						return (
							<button
								key={section.id}
								type="button"
								onClick={() => setSelectedId(section.id)}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors",
									isActive
										? "bg-[var(--accent)] text-[var(--accent-foreground)]"
										: "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
								)}
							>
								<Icon className="size-3.5 shrink-0" />
								<span className="truncate">{section.label}</span>
							</button>
						);
					})}
				</nav>
				<div className="min-w-0 flex-1 overflow-y-auto p-5 pt-4">
					{active ? (
						<>
							<header className="mb-4">
								<h2 className="text-sm font-semibold">{active.label}</h2>
								{active.description ? (
									<p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
										{active.description}
									</p>
								) : null}
							</header>
							<div className="flex flex-col gap-5">{active.content}</div>
						</>
					) : null}
				</div>
			</div>
		</DialogContent>
	);
}
