import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Link, useRouterState } from "@tanstack/react-router";
import { Layers, Library } from "lucide-react";
import { useCallback, useMemo } from "react";
import { SidebarTabRow } from "./SidebarTabRow";
import { useSidebarTabs } from "./SidebarTabsContext";
import {
	isCardLibraryRoute,
	isRootTab,
	moveSidebarTab,
	sortTabsForDisplay,
} from "./sidebar-tabs";

export function SidebarTabs() {
	const {
		tabs,
		activeTabKey,
		navigateToTab,
		closeTab,
		togglePinned,
		reorderTabs,
	} = useSidebarTabs();
	const { location } = useRouterState();

	const displayed = useMemo(() => sortTabsForDisplay(tabs), [tabs]);
	const rootTab = displayed[0];
	const sortableTabs = useMemo(
		() => displayed.filter((tab) => !isRootTab(tab)),
		[displayed],
	);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 4 },
		}),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const activeId = String(event.active.id);
			const overId = event.over ? String(event.over.id) : null;
			if (!overId || overId === activeId) return;
			reorderTabs(moveSidebarTab(tabs, activeId, overId));
		},
		[reorderTabs, tabs],
	);

	const isCardLib = isCardLibraryRoute(location.pathname);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
			{/* Fixed top items */}
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

			{/* Separator + sortable tabs */}
			{sortableTabs.length > 0 && (
				<div className="mt-1 border-t border-[var(--border)] pt-1">
					<DndContext
						collisionDetection={closestCenter}
						sensors={sensors}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={sortableTabs.map((tab) => tab.key)}
							strategy={verticalListSortingStrategy}
						>
							<div className="flex flex-col gap-px">
								{sortableTabs.map((tab) => (
									<SidebarTabRow
										key={tab.key}
										tab={tab}
										active={tab.key === activeTabKey}
										onNavigate={navigateToTab}
										onPinToggle={togglePinned}
										onClose={closeTab}
									/>
								))}
							</div>
						</SortableContext>
					</DndContext>
				</div>
			)}
		</div>
	);
}
