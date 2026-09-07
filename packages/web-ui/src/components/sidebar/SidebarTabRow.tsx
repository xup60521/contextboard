import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, Layers, Pin, PinOff, X } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import {
	sidebarActionClass,
	sidebarRevealClass,
	sidebarRowClass,
	sidebarRowIconClass,
} from "./sidebar-row";
import {
	isRootTab,
	type SidebarTab,
	type SidebarTabSection,
} from "./sidebar-tabs";

type SidebarTabRowProps = {
	tab: SidebarTab;
	section: SidebarTabSection;
	active: boolean;
	onNavigate: (tab: SidebarTab) => void;
	onPinToggle: (key: string) => void;
	onClose: (key: string) => void;
};

export const sidebarTabIcon = (tab: SidebarTab) =>
	tab.kind === "whiteboard" ? Layers : FileText;

export const isMissingWhiteboardTab = (tab: SidebarTab) =>
	tab.kind === "whiteboard" &&
	tab.id !== null &&
	tab.title === "Missing whiteboard";

export function SidebarTabRow({
	tab,
	section,
	active,
	onNavigate,
	onPinToggle,
	onClose,
}: SidebarTabRowProps) {
	const isFixedRoot = isRootTab(tab);
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable({
		id: tab.key,
		data: {
			type: "tab",
			section,
		},
		disabled: isFixedRoot,
	});

	const style = useMemo<CSSProperties>(
		() => ({
			transform: CSS.Transform.toString(transform),
			transition,
		}),
		[transform, transition],
	);

	const tone = isMissingWhiteboardTab(tab) ? "warning" : "default";
	const Icon = sidebarTabIcon(tab);

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...(isFixedRoot ? {} : { ...attributes, ...listeners })}
			aria-label={isFixedRoot ? undefined : "Reorder tab"}
			data-dragging={isDragging ? "true" : "false"}
			data-active={active ? "true" : "false"}
			data-section={section}
			className={[
				sidebarRowClass({ active, tone }),
				isFixedRoot ? "" : "cursor-grab active:cursor-grabbing",
				// The overlay carries the drag; the row it left behind is just a gap.
				isDragging ? "opacity-40" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			<button
				type="button"
				onClick={() => onNavigate(tab)}
				aria-label="Open sidebar tab"
				aria-current={active ? "page" : undefined}
				title={tab.title}
				className="flex min-w-0 flex-1 items-center gap-2 rounded text-left outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
			>
				<Icon className={sidebarRowIconClass({ active, tone })} />
				<span className="truncate">{tab.title}</span>
			</button>

			{!isFixedRoot && (
				<div
					className={[
						"flex shrink-0 items-center gap-px",
						// A pinned tab keeps its unpin control visible: the pin is state
						// the row is advertising, not an action hidden behind hover.
						tab.pinned ? "" : sidebarRevealClass,
					].join(" ")}
				>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onPinToggle(tab.key);
						}}
						aria-label={tab.pinned ? "Unpin tab" : "Pin tab"}
						title={tab.pinned ? "Unpin tab" : "Pin tab"}
						className={sidebarActionClass}
					>
						{tab.pinned ? (
							<PinOff className="size-3" />
						) : (
							<Pin className="size-3" />
						)}
					</button>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onClose(tab.key);
						}}
						aria-label="Close tab"
						title="Close tab"
						className={sidebarActionClass}
					>
						<X className="size-3" />
					</button>
				</div>
			)}
		</div>
	);
}
