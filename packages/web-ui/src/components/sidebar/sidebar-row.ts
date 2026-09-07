import { cva } from "class-variance-authority";

/**
 * Every navigable line in the rail — the board, the library, each tab — shares
 * one set of metrics. Without this the three stacks drifted apart in height and
 * padding, which is what made the column read as three lists glued together.
 */
export const sidebarRowClass = cva(
	[
		"group relative flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] outline-none",
		"transition-[background-color,color] duration-150",
		"before:absolute before:left-0 before:top-1/2 before:h-3.5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--ring)] before:opacity-0 before:transition-opacity",
		"focus-visible:ring-[3px] focus-visible:ring-ring/50",
	].join(" "),
	{
		variants: {
			active: {
				true: "bg-[var(--accent)] font-medium text-[var(--card-foreground)] before:opacity-100",
				false: "font-normal text-[var(--muted-foreground)]",
			},
			tone: {
				default: "",
				warning: "",
			},
		},
		// Hover lives here rather than on `active` so a warning row never emits
		// two competing `hover:bg-*` classes and leaves the winner to CSS order.
		compoundVariants: [
			{
				active: false,
				tone: "default",
				class:
					"hover:bg-[var(--accent)]/60 hover:text-[var(--card-foreground)]",
			},
			{
				active: false,
				tone: "warning",
				class:
					"bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-200",
			},
			{
				active: true,
				tone: "warning",
				class: "text-amber-700 dark:text-amber-200",
			},
		],
		defaultVariants: { active: false, tone: "default" },
	},
);

export const sidebarRowIconClass = cva("size-3.5 shrink-0 transition-colors", {
	variants: {
		active: {
			true: "text-[var(--ring)]",
			false:
				"text-[var(--muted-foreground)] group-hover:text-[var(--card-foreground)]",
		},
		tone: {
			default: "",
			warning: "text-amber-600 dark:text-amber-300",
		},
	},
	defaultVariants: { active: false, tone: "default" },
});

/** Icon buttons that live inside a row: pin, close, and the section actions. */
export const sidebarActionClass =
	"flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] outline-none transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--card-foreground)] focus-visible:ring-[2px] focus-visible:ring-ring/50 dark:hover:bg-white/10";

/**
 * Controls that only matter once you are looking at their row. They stay in the
 * tab order and un-hide on focus, so hover-reveal never costs keyboard reach.
 */
export const sidebarRevealClass =
	"opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100";
