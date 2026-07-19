import { useNavigate } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CardInfoSection } from "./CardInfoSection";
import { CardDetailDocumentSurface } from "./CardDetailDocumentSurface";
import { SidebarOpenButton } from "../navigation/SidebarOpenButton";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { WhiteboardPickerDialog } from "../whiteboard/WhiteboardPickerDialog";
import { CARD_EDITOR_MAX_WIDTH } from "#/lib/constants";

type CardDetailPageProps = {
	cardId: Id<"cards">;
};

export function CardDetailPage({ cardId }: CardDetailPageProps) {
	const data = useQuery(api.cards.get, { cardId });
	const whiteboards = useQuery(api.whiteboards.listActive);
	const archiveCard = useMutation(api.cards.archiveCard);
	const appendToWhiteboard = useMutation(api.cards.appendToWhiteboard);
	const navigate = useNavigate();

	const [deleteOpen, setDeleteOpen] = useState(false);
	const [appendOpen, setAppendOpen] = useState(false);

	useResetAppScroll(cardId);

	useEffect(() => {
		setDeleteOpen(false);
		setAppendOpen(false);
	}, [cardId]);

	const whiteboardTitleById = useMemo(
		() =>
			new Map(
				(whiteboards ?? []).map((whiteboard) => [
					whiteboard._id,
					whiteboard.title,
				]),
			),
		[whiteboards],
	);

	const handleDelete = async () => {
		if (!data) {
			return;
		}

		await archiveCard({ cardId });
		setDeleteOpen(false);

		if (data.placements.length === 0) {
			void navigate({ to: "/cards/orphans" });
			return;
		}

		if (data.boardWhiteboardId) {
			void navigate({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: data.boardWhiteboardId },
			});
			return;
		}

		void navigate({ to: "/whiteboard" });
	};

	const handleAppend = async (whiteboardId: Id<"whiteboards">) => {
		const placement = await appendToWhiteboard({ cardId, whiteboardId });
		setAppendOpen(false);

		if (!placement) return;

		void navigate({
			to: "/whiteboard/$whiteboardId",
			params: { whiteboardId: placement.whiteboardId },
			search: { focus: placement.shapeId },
		});
	};

	return (
		<main
			className="min-h-screen bg-[var(--card)]"
			data-testid="card-detail-page"
		>
			<header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-[var(--card)] px-4 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<SidebarOpenButton />
					<div className="min-w-0">
						{data === undefined ? (
							<div
								className="h-4 w-32 rounded bg-[var(--line)]"
								data-testid="card-detail-title-skeleton"
							/>
						) : (
							<p className="truncate text-sm font-semibold text-[var(--sea-ink)]">
								{data?.card.derivedTitle || "Untitled card"}
							</p>
						)}
					</div>
				</div>

				{data ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-sm" className="shrink-0">
								<MoreHorizontal className="size-5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => setAppendOpen(true)}>
								Place on whiteboard...
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => setDeleteOpen(true)}
								className="text-red-500"
							>
								<Trash2 className="size-4" />
								Delete card
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				) : (
					<div
						className="h-9 w-9 rounded-md bg-[var(--line)]"
						data-testid="card-detail-actions-skeleton"
					/>
				)}
			</header>

			<WhiteboardPickerDialog
				open={appendOpen}
				onOpenChange={setAppendOpen}
				onSelect={handleAppend}
			/>

			<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete card</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this card? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={() => void handleDelete()}>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<section
				className="w-full px-4 py-12"
				style={{ maxWidth: CARD_EDITOR_MAX_WIDTH, marginInline: "auto" }}
			>
				{data === undefined ? (
					<CardEditorShell label="Loading card..." />
				) : data === null ? (
					<CardEditorShell label="Card not found." />
				) : (
					<>
						<CardDetailDocumentSurface
							cardId={data.card._id}
							content={data.card.content as JSONContent}
							whiteboardId={data.boardWhiteboardId}
						/>
						<CardInfoSection
							placements={data.placements}
							backlinks={data.backlinks}
							whiteboardTitleById={whiteboardTitleById}
							createdAt={data.card._creationTime}
							updatedAt={data.card.updatedAt}
							plainText={data.card.plainText}
						/>
					</>
				)}
			</section>
		</main>
	);
}

function CardEditorShell({ label }: { label: string }) {
	return (
		<div
			className="grid min-h-[60vh] place-items-center p-3"
			data-testid="card-detail-shell"
		>
			<div className="rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--sea-ink)]">
				{label}
			</div>
		</div>
	);
}

function useResetAppScroll(cardId: string) {
	useEffect(() => {
		const scrollHost = document.querySelector<HTMLElement>(
			"[data-app-scroll-host='true']",
		);

		scrollHost?.scrollTo({ top: 0 });
	}, [cardId]);
}
