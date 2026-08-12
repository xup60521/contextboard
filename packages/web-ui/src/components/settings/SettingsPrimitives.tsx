import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

/**
 * The vocabulary every settings pane is built from. Sections describe what they
 * control; spacing, weight and colour are decided here once, so two settings
 * written a year apart still look like the same product.
 */

/** A titled block of related controls. */
export function SettingsGroup({
	title,
	description,
	children,
}: {
	title?: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2">
			{title ? (
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
					{title}
				</p>
			) : null}
			{description ? (
				<p className="text-xs text-[var(--muted-foreground)]">{description}</p>
			) : null}
			{children}
		</section>
	);
}

/** A single setting: what it does on the left, the control that changes it on the right. */
export function SettingsRow({
	title,
	description,
	control,
	children,
}: {
	title: string;
	description?: ReactNode;
	control?: ReactNode;
	/** Detail rendered under the row, such as the consequence of the current value. */
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<p className="text-xs font-medium">{title}</p>
					{description ? (
						<p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
							{description}
						</p>
					) : null}
				</div>
				{control ? <div className="shrink-0">{control}</div> : null}
			</div>
			{children}
		</div>
	);
}

/**
 * A bordered row for repeated items, such as a workspace with its actions. It
 * wraps rather than overflows: the pane is narrow and item labels are not.
 */
export function SettingsItem({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-end gap-2 rounded-md border border-[var(--border)] px-2 py-1.5",
				className,
			)}
		>
			{children}
		</div>
	);
}

export type SettingsChoiceOption<T extends string> = {
	value: T;
	label: string;
	icon?: LucideIcon;
};

/** A segmented control: the whole set of values stays visible and one is chosen. */
export function SettingsChoice<T extends string>({
	value,
	options,
	onChange,
	disabled,
	label,
}: {
	value: T;
	options: ReadonlyArray<SettingsChoiceOption<T>>;
	onChange: (value: T) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<fieldset className="flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5">
			<legend className="sr-only">{label}</legend>
			{options.map((option) => {
				const Icon = option.icon;
				const selected = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={selected}
						disabled={disabled}
						onClick={() => onChange(option.value)}
						className={cn(
							"flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
							selected
								? "bg-[var(--accent)] text-[var(--accent-foreground)]"
								: "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
						)}
					>
						{Icon ? <Icon className="size-3.5" /> : null}
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}

/** Read-only detail, such as a version or an endpoint. */
export function SettingsFact({
	label,
	value,
}: {
	label: string;
	value: ReactNode;
}) {
	return (
		<div className="flex items-baseline justify-between gap-4 text-xs">
			<span className="text-[var(--muted-foreground)]">{label}</span>
			<span className="min-w-0 truncate font-mono">{value}</span>
		</div>
	);
}

const toneClasses = {
	info: "border-[var(--border)] text-[var(--muted-foreground)]",
	warning:
		"border-amber-300/70 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/20",
	error:
		"border-red-300/70 text-red-600 dark:border-red-800/60 dark:text-red-400",
} satisfies Record<string, string>;

/** A framed message: a confirmation prompt, a caveat, or a failure. */
export function SettingsMessage({
	tone = "info",
	role,
	children,
}: {
	tone?: keyof typeof toneClasses;
	role?: "alert";
	children: ReactNode;
}) {
	return (
		<div
			role={role}
			className={cn("rounded-md border p-3 text-xs", toneClasses[tone])}
		>
			{children}
		</div>
	);
}
