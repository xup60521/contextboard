import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, Layers, Pin, PinOff, X } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
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

export function SidebarTabRow({
	tab,
	section,
	active,
	onNavigate,
	onPinToggle,
	onClose,
}: SidebarTabRowProps) {
	const isFixedRoot = isRootTab(tab);
	const { attributes, isDragging, listeners, setNodeRef, transform, transition } =
		useSortable({
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

	const isMissingWhiteboard =
		tab.kind === "whiteboard" && tab.id !== null && tab.title === "Missing whiteboard";
	const Icon = tab.kind === "whiteboard" ? Layers : FileText;

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...(isFixedRoot ? {} : { ...attributes, ...listeners })}
			data-dragging={isDragging ? "true" : "false"}
			data-active={active ? "true" : "false"}
			data-section={section}
			className={[
				"group flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] transition-colors",
				!isFixedRoot ? "cursor-grab active:cursor-grabbing" : "",
				active
					? "border-transparent bg-[var(--accent)] text-[var(--card-foreground)]"
					: isMissingWhiteboard
						? "border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-100"
						: "border-transparent hover:bg-[var(--accent)]",
				isDragging ? "opacity-70" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			<button
				type="button"
				onClick={() => onNavigate(tab)}
				aria-current={active ? "page" : undefined}
				className={[
					"flex min-w-0 flex-1 items-center gap-1.5 rounded py-0.5 text-left outline-none transition-colors",
					active ? "text-inherit" : "text-[var(--card-foreground)]",
					"focus-visible:ring-[3px] focus-visible:ring-ring/50",
				].join(" ")}
			>
				<Icon
					className={[
						"size-3.5 shrink-0",
						active
							? "text-inherit"
							: isMissingWhiteboard
								? "text-amber-700 dark:text-amber-200"
								: "text-[var(--muted-foreground)]",
					].join(" ")}
				/>
				<span className="truncate font-medium">{tab.title}</span>
			</button>

			{!isFixedRoot && (
				<div
					className={[
						"flex shrink-0 gap-px transition-opacity",
						tab.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
					].join(" ")}
				>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onPinToggle(tab.key);
						}}
						aria-label={tab.pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`}
						title={tab.pinned ? "Unpin tab" : "Pin tab"}
						className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] outline-none transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--card-foreground)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						{tab.pinned ? (
							<Pin className="size-3" />
						) : (
							<PinOff className="size-3" />
						)}
					</button>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onClose(tab.key);
						}}
						aria-label={`Close ${tab.title}`}
						title="Close tab"
						className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] outline-none transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--card-foreground)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						<X className="size-3" />
					</button>
				</div>
			)}
		</div>
	);
}
