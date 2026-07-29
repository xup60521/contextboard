import { Monitor, Moon, Sun, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { Button } from "../ui/button.tsx";
import { useThemeMode } from "../../hooks/useThemeMode.ts";
import { setThemeMode, type ThemeMode } from "../../lib/theme.ts";
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
			className={`overflow-hidden transition-[width] duration-300 ease-in-out ${isOpen ? "w-56" : "w-0"}`}
		>
			<aside
				aria-hidden={!isOpen}
				className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]"
			>
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
				{mounted ? children : null}
				{mounted ? footer : null}
			</aside>
		</div>
	);
}
