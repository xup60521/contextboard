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
export { AppSidebar } from "./components/sidebar/AppSidebar.tsx";
export type {
	AccountSummary,
	SidebarFooterRuntime,
} from "./components/sidebar/AppSidebar.tsx";
export {
	SidebarTabsContext,
	SidebarTabsProvider,
	useSidebarTabs,
} from "./components/sidebar/SidebarTabsContext.tsx";
export type {
	SidebarRouteState,
	SidebarTabsContextValue,
} from "./components/sidebar/SidebarTabsContext.tsx";
export { SidebarTabs } from "./components/sidebar/SidebarTabs.tsx";
export { SidebarTabRow } from "./components/sidebar/SidebarTabRow.tsx";
export { ClearOpenTabsDialog } from "./components/sidebar/ClearOpenTabsDialog.tsx";
export * from "./components/sidebar/sidebar-tabs.ts";
export {
	useCardLibrarySelection,
} from "./components/cards/useCardLibrarySelection.ts";
export type { SelectionRect } from "./components/cards/useCardLibrarySelection.ts";
export { DeleteCardDialog } from "./components/cards/DeleteCardDialog.tsx";
export { CardGrid } from "./components/cards/CardGrid.tsx";
export { CardLibraryToolbar } from "./components/cards/CardLibraryToolbar.tsx";
export { useCardLibraryActions } from "./components/cards/useCardLibraryActions.ts";
export { CardPreviewDialog } from "./components/cards/CardPreviewDialog.tsx";
export { CardLibraryPage } from "./components/cards/CardLibraryPage.tsx";
export type {
	CardLibrarySearchAdapter,
	CardLibrarySearchState,
} from "./components/cards/CardLibraryPage.tsx";
export {
	CardInfoSection,
	groupPlacementsByWhiteboard,
} from "./components/cards/CardInfoSection.tsx";
export { useDebouncedCardSave } from "./components/cards/useDebouncedCardSave.ts";
export { useResolvedCardContent } from "./components/cards/useResolvedCardContent.ts";
export { CardDocumentEditor } from "./components/cards/CardDocumentEditor.tsx";
export type { CardDocumentEditorProps } from "./components/cards/CardDocumentEditor.tsx";
export { CardDetailDocumentSurface } from "./components/cards/CardDetailDocumentSurface.tsx";
export { CardDetailPage } from "./components/cards/CardDetailPage.tsx";
export type {
	Placement,
	PlacementGroup,
} from "./components/cards/CardInfoSection.tsx";
export { WhiteboardPickerDialog } from "./components/whiteboard/WhiteboardPickerDialog.tsx";
