/**
 * The single source of UI for ContextBoard.
 *
 * Web and Desktop both render these components; platform differences live in
 * the runtime adapters they inject, never in a second copy of the UI. Nothing
 * here may import Dexie, a Web auth/sync provider, Tauri, TanStack Start server
 * APIs, or a concrete route tree.
 */

// Platform shells override how card content opens external links.
export {
	type ExternalLinkOpener,
	setExternalLinkOpener,
} from "@contextboard/editor";
export { CardDetailDocumentSurface } from "./components/cards/CardDetailDocumentSurface.tsx";
export { CardDetailPage } from "./components/cards/CardDetailPage.tsx";
export type { CardDocumentEditorProps } from "./components/cards/CardDocumentEditor.tsx";
export { CardDocumentEditor } from "./components/cards/CardDocumentEditor.tsx";
export { CardGrid } from "./components/cards/CardGrid.tsx";
export type {
	Placement,
	PlacementGroup,
} from "./components/cards/CardInfoSection.tsx";
export {
	CardInfoSection,
	groupPlacementsByWhiteboard,
} from "./components/cards/CardInfoSection.tsx";
export type {
	CardLibrarySearchAdapter,
	CardLibrarySearchState,
} from "./components/cards/CardLibraryPage.tsx";
export { CardLibraryPage } from "./components/cards/CardLibraryPage.tsx";
export { CardLibraryToolbar } from "./components/cards/CardLibraryToolbar.tsx";
export {
	CardPreviewDialog,
	isInsidePreviewAllowedPortal,
	shouldPreventPreviewOutsideDismiss,
} from "./components/cards/CardPreviewDialog.tsx";
export { DeleteCardDialog } from "./components/cards/DeleteCardDialog.tsx";
export { useCardLibraryActions } from "./components/cards/useCardLibraryActions.ts";
export type { SelectionRect } from "./components/cards/useCardLibrarySelection.ts";
export { useCardLibrarySelection } from "./components/cards/useCardLibrarySelection.ts";
export { useDebouncedCardSave } from "./components/cards/useDebouncedCardSave.ts";
export { useResolvedCardContent } from "./components/cards/useResolvedCardContent.ts";
export { CardEditorPane } from "./components/editor/CardEditorPane.tsx";
export { useCardReferenceSupport } from "./components/editor/useCardReferenceSupport.ts";
export { useImageUpload } from "./components/editor/useImageUpload.ts";
export {
	AppLink,
	type AppLinkProps,
} from "./components/navigation/AppLink.tsx";
export { SidebarOpenButton } from "./components/navigation/SidebarOpenButton.tsx";
export {
	CommandPalette,
	type CommandPaletteProps,
} from "./components/search/CommandPalette.tsx";
export {
	type AccountSettingsRuntime,
	accountSettingsSection,
} from "./components/settings/AccountSection.tsx";
export { appearanceSettingsSection } from "./components/settings/AppearanceSection.tsx";
export {
	SettingsDialogContent,
	type SettingsSection,
	SettingsTriggerButton,
} from "./components/settings/SettingsDialog.tsx";
export {
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsFact,
	SettingsGroup,
	SettingsItem,
	SettingsMessage,
	SettingsRow,
} from "./components/settings/SettingsPrimitives.tsx";
export { syncStateLabel } from "./components/settings/sync-status.ts";
export type {
	AccountSummary,
	SidebarFooterRuntime,
} from "./components/sidebar/AppSidebar.tsx";
export { AppSidebar } from "./components/sidebar/AppSidebar.tsx";
export { ClearOpenTabsDialog } from "./components/sidebar/ClearOpenTabsDialog.tsx";
export { SidebarTabRow } from "./components/sidebar/SidebarTabRow.tsx";
export { SidebarTabs } from "./components/sidebar/SidebarTabs.tsx";
export type {
	SidebarRouteState,
	SidebarTabsContextValue,
} from "./components/sidebar/SidebarTabsContext.tsx";
export {
	SidebarTabsContext,
	SidebarTabsProvider,
	useSidebarTabs,
} from "./components/sidebar/SidebarTabsContext.tsx";
export * from "./components/sidebar/sidebar-tabs.ts";
export { Button, buttonVariants } from "./components/ui/button.tsx";
export * from "./components/ui/command.tsx";
export * from "./components/ui/context-menu.tsx";
export * from "./components/ui/dialog.tsx";
export * from "./components/ui/dropdown-menu.tsx";
export { AppSidebarFrame } from "./components/whiteboard/AppSidebarFrame.tsx";
export { DeleteWhiteboardDialog } from "./components/whiteboard/DeleteWhiteboardDialog.tsx";
export { EditableWhiteboardTitle } from "./components/whiteboard/EditableWhiteboardTitle.tsx";
export type { Id } from "./components/whiteboard/ids.ts";
export {
	useWhiteboardNavigation,
	type WhiteboardNavigation,
} from "./components/whiteboard/navigation.ts";
export {
	SidebarContext,
	SidebarProvider,
	useSidebarContext,
} from "./components/whiteboard/SidebarContext.tsx";
export { WhiteboardCanvas } from "./components/whiteboard/WhiteboardCanvas.tsx";
export { WhiteboardCardPreviewLayer } from "./components/whiteboard/WhiteboardCardPreviewLayer.tsx";
export { WhiteboardPickerDialog } from "./components/whiteboard/WhiteboardPickerDialog.tsx";
export { WhiteboardPreviewDialog } from "./components/whiteboard/WhiteboardPreviewDialog.tsx";
export { useAccents } from "./hooks/useAccents.ts";
export { useThemeMode } from "./hooks/useThemeMode.ts";
export { whiteboardPreviewCardIdAtom } from "./lib/atoms.ts";
export {
	ACCENTS,
	type Accent,
	type Accents,
	applyAccents,
	applyThemeMode,
	DEFAULT_ACCENT,
	getAccents,
	getResolvedTheme,
	getThemeMode,
	initTheme,
	type ResolvedTheme,
	setAccent,
	setThemeMode,
	subscribeThemeMode,
	type ThemeMode,
} from "./lib/theme.ts";
export { cn } from "./lib/utils.ts";
