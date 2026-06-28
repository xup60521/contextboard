import { Link } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronRight,
	Clock,
	FileText,
	Info,
	LayoutGrid,
	Link2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

export type Placement = {
	itemId: string;
	whiteboardId: Id<"whiteboards"> | null;
	shapeId: string | null;
	updatedAt?: number;
};

export type PlacementGroup = {
	key: string;
	whiteboardId: Id<"whiteboards"> | null;
	title: string;
	placements: Placement[];
	count: number;
	primaryPlacement: Placement;
};

export function groupPlacementsByWhiteboard(
	placements: Placement[],
	whiteboardTitleById: Map<Id<"whiteboards">, string>,
): PlacementGroup[] {
	const groups = new Map<string, PlacementGroup>();

	for (const placement of placements) {
		const key = placement.whiteboardId ?? "__root__";
		const title = placement.whiteboardId
			? (whiteboardTitleById.get(placement.whiteboardId) ?? placement.whiteboardId)
			: "Root";

		const existing = groups.get(key);
		if (!existing) {
			groups.set(key, {
				key,
				whiteboardId: placement.whiteboardId,
				title,
				placements: [placement],
				count: 1,
				primaryPlacement: placement,
			});
			continue;
		}

		existing.placements.push(placement);
		existing.count += 1;

		if ((placement.updatedAt ?? 0) > (existing.primaryPlacement.updatedAt ?? 0)) {
			existing.primaryPlacement = placement;
		}
	}

	return Array.from(groups.values()).sort((a, b) => {
		const newestA = Math.max(...a.placements.map((p) => p.updatedAt ?? 0));
		const newestB = Math.max(...b.placements.map((p) => p.updatedAt ?? 0));

		if (newestA !== newestB) return newestB - newestA;
		return a.title.localeCompare(b.title);
	});
}

type Backlink = {
	cardId: Id<"cards">;
	title: string;
	boardWhiteboardId: Id<"whiteboards"> | null;
	shapeId: string | null;
};

type CardInfoSectionProps = {
	placements: Placement[];
	backlinks: Backlink[];
	whiteboardTitleById: Map<Id<"whiteboards">, string>;
	createdAt: number;
	updatedAt: number;
	plainText: string;
	onNavigate?: () => void;
};

function formatDate(ts: number): string {
	return new Date(ts).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	const s = Math.floor(diff / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	const mo = Math.floor(d / 30);
	const y = Math.floor(d / 365);
	if (s < 60) return "just now";
	if (m < 60) return `${m} minute${m !== 1 ? "s" : ""} ago`;
	if (h < 24) return `${h} hour${h !== 1 ? "s" : ""} ago`;
	if (d < 30) return `${d} day${d !== 1 ? "s" : ""} ago`;
	if (mo < 12) return `${mo} month${mo !== 1 ? "s" : ""} ago`;
	return `${y} year${y !== 1 ? "s" : ""} ago`;
}

function wordCount(text: string): number {
	return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function CardInfoSection({
	placements,
	backlinks,
	whiteboardTitleById,
	createdAt,
	updatedAt,
	plainText,
	onNavigate,
}: CardInfoSectionProps) {
	const [visible, setVisible] = useState(true);
	// collapsed set — groups start expanded
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	// Group backlinks by whiteboard
	const groups = new Map<string, { label: string; links: Backlink[] }>();
	for (const bl of backlinks) {
		const key = bl.boardWhiteboardId ?? "__orphan__";
		if (!groups.has(key)) {
			const label =
				bl.boardWhiteboardId
					? (whiteboardTitleById.get(bl.boardWhiteboardId) ?? bl.boardWhiteboardId)
					: "No whiteboard";
			groups.set(key, { label, links: [] });
		}
		groups.get(key)!.links.push(bl);
	}

	// Group placements by whiteboard
	const placementGroups = groupPlacementsByWhiteboard(placements, whiteboardTitleById);

	const toggleGroup = (key: string) =>
		setCollapsed((prev: Set<string>) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	const words = wordCount(plainText);
	const chars = plainText.length;

	return (
		<div className={"mt-10" + (!visible ? " border-t border-[var(--line)]" : "")}>
			{/* Section header */}
			<div className="flex items-center justify-between py-4">
				<div className="flex items-center gap-2 text-xs font-medium text-[var(--sea-ink)]">
					<Info className="size-3.5 text-[var(--sea-ink-soft)]" />
					<span>Info</span>
				</div>
				<button
					type="button"
					onClick={() => setVisible((v: boolean) => !v)}
					className="rounded px-2 py-1 text-xs text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
				>
					{visible ? "Hide" : "Show"}
				</button>
			</div>

			{visible && (
				<>
					{/* Metadata */}
					<div className="border-t border-[var(--line)] py-5 grid gap-3">
						<MetaRow
							icon={<Clock className="size-3" />}
							label="Created"
							value={formatDate(createdAt)}
						/>
						<MetaRow
							icon={<Clock className="size-3" />}
							label="Updated"
							value={relativeTime(updatedAt)}
						/>
						<MetaRow
							icon={
								<span className="text-[9px] font-bold leading-none tracking-tighter">
									T↕
								</span>
							}
							label="Count"
							value={
								<span>
									<span className="font-semibold text-[var(--sea-ink)]">{words}</span>
									<span className="text-[var(--sea-ink-soft)]"> Words</span>
									{"⠀"}
									<span className="font-semibold text-[var(--sea-ink)]">{chars}</span>
									<span className="text-[var(--sea-ink-soft)]"> Characters</span>
								</span>
							}
						/>
					</div>

					{/* Backlinks */}
					<div className="border-t border-[var(--line)] py-4">
						<div className="mb-2.5 flex items-center gap-1.5 px-1 text-xs font-medium text-[var(--sea-ink)]">
							<Link2 className="size-3 text-[var(--sea-ink-soft)]" />
							<span>Backlinks ({backlinks.length})</span>
							{backlinks.length === 0 && (
								<span className="font-normal text-[var(--sea-ink-soft)]">— No backlinks yet.</span>
							)}
						</div>
						{backlinks.length === 0 ? null : (
							<div className="grid gap-1">
								{Array.from(groups.entries()).map(([key, { label, links }]) => {
									const isExpanded = !collapsed.has(key);
									return (
										<div key={key}>
											<button
												type="button"
												onClick={() => toggleGroup(key)}
												className="flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-xs text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
											>
												{isExpanded ? (
													<ChevronDown className="size-3 shrink-0" />
												) : (
													<ChevronRight className="size-3 shrink-0" />
												)}
												<FileText className="size-3 shrink-0 text-[var(--sea-ink-soft)]" />
												<span className="truncate">{label}</span>
											</button>
											{isExpanded && (
												<div className="ml-5 grid gap-0.5">
													{links.map((bl) => (
														<Link
															key={bl.cardId}
															to="/cards/$cardId"
															params={{ cardId: bl.cardId }}
															onClick={onNavigate}
															className="flex items-center gap-1.5 rounded px-1 py-1.5 text-xs text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
														>
															<FileText className="size-3 shrink-0 text-[var(--sea-ink-soft)]" />
															<span className="truncate">{bl.title || "Untitled"}</span>
														</Link>
													))}
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>

			{/* Whiteboards */}
					<div className="border-t border-[var(--line)] py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
						<div className="flex items-center gap-1.5 text-xs font-medium text-[var(--sea-ink)]">
							<LayoutGrid className="size-3 text-[var(--sea-ink-soft)]" />
							<span>Whiteboards ({placementGroups.length})</span>
						</div>
						{placementGroups.length === 0 && (
							<span className="text-xs text-[var(--sea-ink-soft)]">
								Not placed on any whiteboard.
							</span>
						)}
						{placementGroups.map((group) => {
							const p = group.primaryPlacement;
							return (
							<Link
								key={group.key}
								to={group.whiteboardId ? "/whiteboard/$whiteboardId" : "/whiteboard"}
								params={group.whiteboardId ? { whiteboardId: group.whiteboardId } : undefined}
								search={p.shapeId ? { focus: p.shapeId } : {}}
								onClick={onNavigate}
								className="flex items-center gap-1 text-xs text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
							>
								<LayoutGrid className="size-3 shrink-0 text-[var(--sea-ink-soft)]" />
								<span>
									{group.title}
									{group.count > 1 ? ` (${group.count})` : ""}
								</span>
							</Link>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}

function MetaRow({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value: ReactNode;
}) {
	return (
		<div className="flex items-center gap-4 px-1">
			<div className="flex w-24 shrink-0 items-center gap-1.5 text-[11px] text-[var(--sea-ink-soft)]">
				{icon}
				<span>{label}</span>
			</div>
			<div className="text-xs font-medium text-[var(--sea-ink)]">{value}</div>
		</div>
	);
}
