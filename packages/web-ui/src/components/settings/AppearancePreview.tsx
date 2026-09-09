import type { CSSProperties } from "react";
import type { Accent } from "../../lib/theme.ts";
import { cn } from "../../lib/utils.ts";

/**
 * A miniature of the app painted with the live theme tokens. Swatches answer
 * "which hue"; they cannot answer "what will the app look like", because the
 * accent now reaches surfaces — the rail, every hover, every selected row —
 * and none of that is visible in a dot.
 *
 * `data-accent-scope` is what lets this show an accent the app has not
 * adopted: `styles.css` shares its derivation block with that attribute, so
 * this subtree re-derives the whole palette from the accent it carries. The
 * pointer can wander the swatches without the document flickering behind the
 * dialog.
 */

/** Real text is illegible at this scale, so a line of it is a bar. */
function Bar({ className }: { className?: string }) {
	return <div className={cn("h-1 rounded-full", className)} />;
}

/**
 * The three states the rail can be in, which is most of what the tint
 * changed. Only the active one carries the accent, in the strong step the
 * real rows use — this is the rule the preview exists to show: colour means
 * "you are here", and nothing else on the rail competes for it.
 */
const ROWS = [
	{ surface: undefined, label: "opacity-50", active: false },
	{
		surface: "bg-[var(--sidebar-row-hover)]",
		label: "opacity-70",
		active: false,
	},
	{ surface: "bg-[var(--sidebar-row-active)]", label: "", active: true },
] as const;

/** Custom accents live in an inline property, exactly as `applyAccent` writes them. */
const brandOverride = (color: string) =>
	({
		"--brand-fill-light": color,
		"--brand-fill-dark": color,
	}) as CSSProperties;

export function AppearancePreview({
	accent,
	customColor,
}: {
	accent: Accent;
	customColor: string;
}) {
	return (
		<div
			aria-hidden
			data-accent-scope
			data-accent-light={accent}
			data-accent-dark={accent}
			style={accent === "custom" ? brandOverride(customColor) : undefined}
			className="flex h-24 select-none overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]"
		>
			<div className="flex w-[38%] shrink-0 flex-col gap-1 border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] p-2">
				<div className="flex items-center gap-1.5 pb-1">
					<span className="size-2.5 shrink-0 rounded-[3px] bg-[var(--primary)]" />
					<Bar className="w-9 bg-[var(--sidebar-foreground)] opacity-80" />
				</div>
				{ROWS.map((row, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: the rows are a fixed illustration
						key={index}
						className={cn(
							"relative flex h-4 items-center gap-1.5 rounded px-1.5",
							row.surface,
						)}
					>
						{row.active ? (
							<span className="absolute left-0 h-2 w-[2px] rounded-r-full bg-[var(--lagoon-strong)]" />
						) : null}
						<span
							className={cn(
								"size-1.5 shrink-0 rounded-[2px]",
								row.active
									? "bg-[var(--lagoon-strong)]"
									: "bg-[var(--muted-foreground)] opacity-70",
							)}
						/>
						<Bar
							className={cn(
								"flex-1",
								row.active
									? "bg-[var(--lagoon-strong)]"
									: "bg-[var(--sidebar-foreground)]",
								row.label,
							)}
						/>
					</div>
				))}
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
				<div className="flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-2">
					<Bar className="w-2/3 bg-[var(--card-foreground)] opacity-80" />
					<Bar className="w-full bg-[var(--muted-foreground)] opacity-60" />
					<Bar className="w-2/5 bg-[var(--lagoon-deep)]" />
				</div>
				<div className="mt-auto flex items-center gap-1.5">
					<span className="h-4 w-10 rounded-[5px] bg-[var(--lagoon)]" />
					<span className="h-4 w-7 rounded-[5px] bg-[var(--accent)]" />
				</div>
			</div>
		</div>
	);
}
