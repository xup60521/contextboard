import { Monitor, Moon, Sun, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SidebarTabs } from "#/components/sidebar/SidebarTabs";
import { Button } from "#/components/ui/button";
import { useThemeMode } from "../../hooks/useThemeMode";
import { setThemeMode, type ThemeMode } from "../../lib/theme";
import { useSidebarContext } from "./SidebarContext";

type Theme = ThemeMode;

const themeIcons: Record<Theme, typeof Sun> = {
	light: Sun,
	dark: Moon,
	auto: Monitor,
};

const themeLabels: Record<Theme, string> = {
	light: "Light",
	dark: "Dark",
	auto: "System",
};

const themeOrder: Theme[] = ["light", "dark", "auto"];

export function AppSidebar() {
	const { isOpen, close } = useSidebarContext();
	const theme = useThemeMode();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const cycleTheme = useCallback(() => {
		const next =
			themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
		setThemeMode(next);
	}, [theme]);

	return (
		<div
			className={`overflow-hidden transition-[width] duration-300 ease-in-out ${isOpen ? "w-56" : "w-0"}`}
		>
			<aside
				aria-hidden={!isOpen}
				className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]"
			>
				{/* Header height matches tldraw's 44px toolbar */}
				<header className="flex h-[44px] shrink-0 items-center gap-1 border-b border-[var(--border)] px-3">
					<span className="mr-auto text-[13px] font-semibold tracking-tight">
						Contextboard
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={cycleTheme}
						aria-label={`Switch theme (current: ${themeLabels[theme]})`}
						title={themeLabels[theme]}
						className="text-[var(--muted-foreground)] hover:text-[var(--card-foreground)]"
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
						className="text-[var(--muted-foreground)] hover:text-[var(--card-foreground)]"
						onClick={close}
						aria-label="Close sidebar"
					>
						<X />
					</Button>
				</header>
				{mounted ? <SidebarTabs /> : null}
			</aside>
		</div>
	);
}
