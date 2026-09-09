import { useApplicationRuntime } from "@contextboard/application";
import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Layers, Library } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { AppLink } from "../navigation/AppLink";
import { Button } from "../ui/button";
import { ClearOpenTabsDialog } from "./ClearOpenTabsDialog";
import { SidebarTabRow, sidebarTabIcon } from "./SidebarTabRow";
import { useSidebarTabs } from "./SidebarTabsContext";
import {
	sidebarRowAccentClass,
	sidebarRowClass,
	sidebarRowIconClass,
} from "./sidebar-row";
import {
	getSidebarTabSection,
	isCardLibraryRoute,
	isRootTab,
	moveSidebarTabByDropTarget,
	OPEN_TABS_DROP_ID,
	PINNED_TABS_DROP_ID,
	type SidebarTabSection,
	sortTabsForDisplay,
} from "./sidebar-tabs";

type SidebarSectionDropZoneProps = {
	dropId: string;
	section: SidebarTabSection;
	label: string;
};

/**
 * Only mounted while a tab is in flight, so an empty section is empty rather
 * than a permanent dashed box explaining a gesture nobody is making.
 */
function SidebarSectionDropZone({
	dropId,
	section,
	label,
}: SidebarSectionDropZoneProps) {
	const { isOver, setNodeRef } = useDroppable({
		id: dropId,
		data: { type: "section", section },
	});

	return (
		<div
			ref={setNodeRef}
			data-section={section}
			data-over={isOver ? "true" : "false"}
			className={[
				"flex min-h-11 items-center justify-center rounded-md border border-dashed px-2 text-center text-[11px] transition-colors",
				isOver
					? "border-[var(--ring)] bg-[var(--ring)]/10 text-[var(--card-foreground)]"
					: "border-[var(--border)] text-[var(--muted-foreground)]",
			].join(" ")}
		>
			{label}
		</div>
	);
}

function SidebarSection({
	label,
	count,
	action,
	children,
}: {
	label: string;
	count?: number;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="group/section flex flex-col gap-0.5">
			<div className="sticky top-0 z-10 flex h-6 items-center gap-1.5 bg-[var(--sidebar)] px-2">
				<span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">
					{label}
				</span>
				{count === undefined ? null : (
					<span className="text-[10px] tabular-nums text-[var(--muted-foreground)]/60">
						{count}
					</span>
				)}
				{action ? (
					<div className="ml-auto opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/section:opacity-100">
						{action}
					</div>
				) : null}
			</div>
			{children}
		</section>
	);
}

export function SidebarTabs() {
	const runtime = useApplicationRuntime();
	const {
		pathname,
		tabs,
		activeTabKey,
		navigateToTab,
		closeTab,
		togglePinned,
		reorderTabs,
		clearOpenTabs,
	} = useSidebarTabs();
	const [draggingTabKey, setDraggingTabKey] = useState<string | null>(null);
	const [showClearDialog, setShowClearDialog] = useState(false);

	const displayed = useMemo(() => sortTabsForDisplay(tabs), [tabs]);
	const rootTab = displayed[0];
	const secondaryTabs = useMemo(
		() => displayed.filter((tab) => !isRootTab(tab)),
		[displayed],
	);
	const pinnedTabs = useMemo(
		() => secondaryTabs.filter((tab) => tab.pinned),
		[secondaryTabs],
	);
	const openTabs = useMemo(
		() => secondaryTabs.filter((tab) => !tab.pinned),
		[secondaryTabs],
	);
	const draggingTab = useMemo(
		() => tabs.find((tab) => tab.key === draggingTabKey) ?? null,
		[draggingTabKey, tabs],
	);
	const draggingSection = draggingTab
		? getSidebarTabSection(draggingTab)
		: null;

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 4 },
		}),
	);

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setDraggingTabKey(String(event.active.id));
	}, []);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setDraggingTabKey(null);

			const activeId = String(event.active.id);
			const overId = event.over ? String(event.over.id) : null;
			const targetSection =
				(event.over?.data.current?.section as SidebarTabSection | undefined) ??
				(overId === PINNED_TABS_DROP_ID
					? "pinned"
					: overId === OPEN_TABS_DROP_ID
						? "open"
						: null);

			if (!overId || (overId === activeId && targetSection === null)) return;

			reorderTabs(
				moveSidebarTabByDropTarget(
					tabs,
					activeId,
					overId,
					targetSection,
					activeTabKey ? [activeTabKey] : [],
				),
			);
		},
		[activeTabKey, reorderTabs, tabs],
	);

	const handleDragCancel = useCallback(() => {
		setDraggingTabKey(null);
	}, []);

	const handleClearConfirm = useCallback(() => {
		setShowClearDialog(false);
		clearOpenTabs();
	}, [clearOpenTabs]);

	const isCardLib = isCardLibraryRoute(pathname);
	const rootActive = rootTab.key === activeTabKey;
	const showPinned = pinnedTabs.length > 0 || draggingSection === "open";
	const showOpen = openTabs.length > 0 || draggingSection === "pinned";
	const DraggingIcon = draggingTab ? sidebarTabIcon(draggingTab) : null;

	return (
		<>
			<nav
				aria-label="Boards and tabs"
				className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-2 py-2 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
			>
				<div className="flex flex-col gap-0.5">
					<button
						type="button"
						onClick={() => navigateToTab(rootTab)}
						aria-current={rootActive ? "page" : undefined}
						title={rootTab.title}
						className={sidebarRowClass({ active: rootActive })}
					>
						<Layers className={sidebarRowIconClass({ active: rootActive })} />
						<span
							className={`truncate ${sidebarRowAccentClass({ active: rootActive })}`}
						>
							{rootTab.title}
						</span>
					</button>

					<AppLink
						href={runtime.navigation.cardsHref()}
						aria-current={isCardLib ? "page" : undefined}
						className={sidebarRowClass({ active: isCardLib })}
					>
						<Library className={sidebarRowIconClass({ active: isCardLib })} />
						<span
							className={`truncate ${sidebarRowAccentClass({ active: isCardLib })}`}
						>
							Card Library
						</span>
					</AppLink>
				</div>

				{secondaryTabs.length > 0 && (
					<DndContext
						collisionDetection={closestCenter}
						sensors={sensors}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
						onDragCancel={handleDragCancel}
					>
						<SortableContext
							items={secondaryTabs.map((tab) => tab.key)}
							strategy={verticalListSortingStrategy}
						>
							{showPinned && (
								<SidebarSection label="Pinned" count={pinnedTabs.length}>
									{pinnedTabs.length > 0 ? (
										<div className="flex flex-col gap-0.5">
											{pinnedTabs.map((tab) => (
												<SidebarTabRow
													key={tab.key}
													tab={tab}
													section="pinned"
													active={tab.key === activeTabKey}
													onNavigate={navigateToTab}
													onPinToggle={togglePinned}
													onClose={closeTab}
												/>
											))}
										</div>
									) : (
										<SidebarSectionDropZone
											dropId={PINNED_TABS_DROP_ID}
											section="pinned"
											label="Drop here to pin"
										/>
									)}
								</SidebarSection>
							)}

							{showOpen && (
								<SidebarSection
									label="Open"
									count={openTabs.length}
									action={
										openTabs.length > 0 ? (
											<Button
												type="button"
												variant="ghost"
												size="xs"
												className="h-5 px-1.5 text-[10px] font-medium text-[var(--muted-foreground)]"
												onClick={() => setShowClearDialog(true)}
												title="Close all open tabs"
											>
												Clear
											</Button>
										) : null
									}
								>
									{openTabs.length > 0 ? (
										<div className="flex flex-col gap-0.5">
											{openTabs.map((tab) => (
												<SidebarTabRow
													key={tab.key}
													tab={tab}
													section="open"
													active={tab.key === activeTabKey}
													onNavigate={navigateToTab}
													onPinToggle={togglePinned}
													onClose={closeTab}
												/>
											))}
										</div>
									) : (
										<SidebarSectionDropZone
											dropId={OPEN_TABS_DROP_ID}
											section="open"
											label="Drop here to unpin"
										/>
									)}
								</SidebarSection>
							)}
						</SortableContext>

						<DragOverlay dropAnimation={null}>
							{draggingTab && DraggingIcon ? (
								<div className="flex h-7 w-full cursor-grabbing items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 text-[13px] font-medium text-[var(--card-foreground)] shadow-lg">
									<DraggingIcon className="size-3.5 shrink-0 text-[var(--ring)]" />
									<span className="truncate">{draggingTab.title}</span>
								</div>
							) : null}
						</DragOverlay>
					</DndContext>
				)}
			</nav>

			<ClearOpenTabsDialog
				open={showClearDialog}
				openTabCount={openTabs.length}
				onCancel={() => setShowClearDialog(false)}
				onConfirm={handleClearConfirm}
			/>
		</>
	);
}
