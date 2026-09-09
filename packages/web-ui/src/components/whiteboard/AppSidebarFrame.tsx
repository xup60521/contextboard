import { Monitor, Moon, Sun, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useThemeMode } from "../../hooks/useThemeMode.ts";
import { setThemeMode, type ThemeMode } from "../../lib/theme.ts";
import { Button } from "../ui/button.tsx";
import { useSidebarContext } from "./SidebarContext.tsx";

const themeIcons: Record<ThemeMode, typeof Sun> = {
	light: Sun,
	dark: Moon,
	auto: Monitor,
};
const themeLabels: Record<ThemeMode, string> = {
	light: "Light",
	dark: "Dark",
	auto: "System",
};
const themeOrder: ThemeMode[] = ["light", "dark", "auto"];

export function AppSidebarFrame({
	children,
	footer,
}: {
	children: ReactNode;
	footer?: ReactNode;
}) {
	const { isOpen, close } = useSidebarContext();
	const theme = useThemeMode();
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);
	const cycleTheme = useCallback(() => {
		const next =
			themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
		setThemeMode(next);
	}, [theme]);

	return (
		<div
			className={`overflow-hidden transition-[width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${isOpen ? "w-60" : "w-0"}`}
		>
			<aside
				aria-hidden={!isOpen}
				className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]"
			>
				<header className="flex h-[44px] shrink-0 items-center gap-2 border-b border-[var(--sidebar-border)] px-2.5">
					<span
						aria-hidden
						className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--primary)] text-[10px] font-bold text-[var(--primary-foreground)]"
					>
						C
					</span>
					<span className="mr-auto truncate text-[13px] font-semibold tracking-tight">
						Contextboard
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={cycleTheme}
						aria-label={`Switch theme (current: ${themeLabels[theme]})`}
						title={themeLabels[theme]}
						className="text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)]"
					>
						{(() => {
							const Icon = themeIcons[theme];
							return <Icon />;
						})()}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)]"
						onClick={close}
						aria-label="Close sidebar"
					>
						<X />
					</Button>
				</header>
				{mounted ? children : null}
				{mounted ? footer : null}
			</aside>
		</div>
	);
}
