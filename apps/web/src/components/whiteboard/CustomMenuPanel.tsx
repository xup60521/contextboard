import { PanelLeft } from "lucide-react";
import { useRef } from "react";
import {
	PORTRAIT_BREAKPOINT,
	TldrawUiToolbar,
	TldrawUiToolbarButton,
	useBreakpoint,
	useEditor,
	usePassThroughWheelEvents,
	useTldrawUiComponents,
	useTranslation,
	useValue,
} from "tldraw";
import { useSidebarContext } from "./SidebarContext";

export function CustomMenuPanel() {
	const { isOpen, open } = useSidebarContext();
	const breakpoint = useBreakpoint();
	const msg = useTranslation();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ref = useRef(null) as any;
	usePassThroughWheelEvents(ref);
	const { MainMenu, QuickActions, ActionsMenu, PageMenu } =
		useTldrawUiComponents();
	const editor = useEditor();
	const isSinglePageMode = useValue(
		"isSinglePageMode",
		() => editor.options.maxPages <= 1,
		[editor],
	);
	const showQuickActions =
		editor.options.actionShortcutsLocation === "menu"
			? true
			: editor.options.actionShortcutsLocation === "toolbar"
				? false
				: breakpoint >= PORTRAIT_BREAKPOINT.TABLET;
	if (!MainMenu && !PageMenu && !showQuickActions) return null;
	return (
		<nav ref={ref} className="tlui-menu-zone">
			<div className="tlui-buttons__horizontal">
				{isOpen ? null : (
					<TldrawUiToolbar label="Whiteboard sidebar">
						<TldrawUiToolbarButton
							type="icon"
							title="Open sidebar"
							aria-label="Open sidebar"
							onClick={open}
						>
							<PanelLeft size={16} />
						</TldrawUiToolbarButton>
					</TldrawUiToolbar>
				)}
				{MainMenu && <MainMenu />}
				{PageMenu && !isSinglePageMode && <PageMenu />}
				{showQuickActions ? (
					<TldrawUiToolbar
						className="tlui-buttons__horizontal"
						label={msg("actions-menu.title")}
					>
						{QuickActions && <QuickActions />}
						{ActionsMenu && <ActionsMenu />}
					</TldrawUiToolbar>
				) : null}
			</div>
		</nav>
	);
}
