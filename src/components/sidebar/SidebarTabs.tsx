import {
	closestCenter,
	DndContext,
	type DragEndEvent,
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
import { Link, useRouterState } from "@tanstack/react-router";
import { Layers, Library } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { ClearOpenTabsDialog } from "./ClearOpenTabsDialog";
import { SidebarTabRow } from "./SidebarTabRow";
import { useSidebarTabs } from "./SidebarTabsContext";
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
	draggingSection: SidebarTabSection | null;
	label: string;
};

function SidebarSectionDropZone({
	dropId,
	section,
	draggingSection,
	label,
}: SidebarSectionDropZoneProps) {
	const { isOver, setNodeRef } = useDroppable({
		id: dropId,
		data: {
			type: "section",
			section,
		},
	});

	const canDropAcrossSections =
		draggingSection !== null && draggingSection !== section;

	return (
		<div
			ref={setNodeRef}
			data-section={section}
			data-over={isOver ? "true" : "false"}
			className={[
				"flex min-h-12 items-center justify-center rounded-md border border-dashed p-2 transition-colors",
				isOver && canDropAcrossSections
					? "border-[var(--ring)] bg-[var(--accent)]/60"
					: "border-transparent",
			].join(" ")}
		>
			<span className="text-center text-xs text-[var(--muted-foreground)]">
				{label}
			</span>
		</div>
	);
}

export function SidebarTabs() {
	const {
		tabs,
		activeTabKey,
		navigateToTab,
		closeTab,
		togglePinned,
		reorderTabs,
		clearOpenTabs,
	} = useSidebarTabs();
	const { location } = useRouterState();
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
	const draggingSection = useMemo(() => {
		if (!draggingTabKey) return null;

		const draggingTab = tabs.find((tab) => tab.key === draggingTabKey);
		return draggingTab ? getSidebarTabSection(draggingTab) : null;
	}, [draggingTabKey, tabs]);

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

	const isCardLib = isCardLibraryRoute(location.pathname);

	return (
		<>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
				<div className="flex flex-col gap-px">
					<button
						type="button"
						onClick={() => navigateToTab(rootTab)}
						aria-current={rootTab.key === activeTabKey ? "page" : undefined}
						className={[
							"flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-medium outline-none transition-colors",
							rootTab.key === activeTabKey
								? "bg-[var(--accent)] text-[var(--card-foreground)]"
								: "text-[var(--card-foreground)] hover:bg-[var(--accent)]",
							"focus-visible:ring-[3px] focus-visible:ring-ring/50",
						].join(" ")}
					>
						<Layers className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
						<span className="truncate">{rootTab.title}</span>
					</button>

					<Link
						to="/cards"
						search={{ orphan: "", sort: "title", q: "" }}
						className={[
							"flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-medium outline-none transition-colors",
							isCardLib
								? "bg-[var(--accent)] text-[var(--card-foreground)]"
								: "text-[var(--card-foreground)] hover:bg-[var(--accent)]",
							"focus-visible:ring-[3px] focus-visible:ring-ring/50",
						].join(" ")}
					>
						<Library className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
						<span className="truncate">Card Library</span>
					</Link>
				</div>

				{secondaryTabs.length > 0 && (
					<div className="mt-1 border-t border-[var(--border)] pt-2">
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
								<div className="mb-2">
									<div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
										Pinned
									</div>
									{pinnedTabs.length > 0 ? (
										<div className="flex flex-col gap-px">
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
											draggingSection={draggingSection}
											label="Drag tabs here to pin them"
										/>
									)}
								</div>

								<div>
									<div className="flex items-center justify-between gap-2 px-1.5 pb-1">
										<div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
											Open Tabs
										</div>
										{openTabs.length > 0 ? (
											<Button
												type="button"
												variant="ghost"
												size="xs"
												onClick={() => setShowClearDialog(true)}
												title="Close all open tabs"
											>
												Clear
											</Button>
										) : null}
									</div>
									{openTabs.length > 0 ? (
										<div className="flex flex-col gap-px">
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
											draggingSection={draggingSection}
											label="Drop pinned tabs here to unpin them"
										/>
									)}
								</div>
							</SortableContext>
						</DndContext>
					</div>
				)}
			</div>

			<ClearOpenTabsDialog
				open={showClearDialog}
				openTabCount={openTabs.length}
				onCancel={() => setShowClearDialog(false)}
				onConfirm={handleClearConfirm}
			/>
		</>
	);
}
