/**
 * The single source of UI for ContextBoard.
 *
 * Web and Desktop both render these components; platform differences live in
 * the runtime adapters they inject, never in a second copy of the UI. Nothing
 * here may import Dexie, a Web auth/sync provider, Tauri, TanStack Start server
 * APIs, or a concrete route tree.
 */

export { cn } from "./lib/utils.ts";
export {
	applyThemeMode,
	getResolvedTheme,
	getThemeMode,
	type ResolvedTheme,
	setThemeMode,
	subscribeThemeMode,
	type ThemeMode,
} from "./lib/theme.ts";
export { useThemeMode } from "./hooks/useThemeMode.ts";

export { Button, buttonVariants } from "./components/ui/button.tsx";
export * from "./components/ui/command.tsx";
export * from "./components/ui/context-menu.tsx";
export * from "./components/ui/dialog.tsx";
export * from "./components/ui/dropdown-menu.tsx";

export { AppSidebarFrame } from "./components/whiteboard/AppSidebarFrame.tsx";
export {
	SidebarContext,
	SidebarProvider,
	useSidebarContext,
} from "./components/whiteboard/SidebarContext.tsx";
export { SidebarOpenButton } from "./components/navigation/SidebarOpenButton.tsx";
