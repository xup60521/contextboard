import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { CardInfoSection } from "#/components/cards/CardInfoSection";
import { CardEditorPane } from "#/components/editor/CardEditorPane";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { WhiteboardPickerDialog } from "#/components/whiteboard/WhiteboardPickerDialog";
import { CARD_EDITOR_MAX_WIDTH } from "#/lib/constants";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/cards/$cardId")({
	ssr: false,
	component: RouteComponent,
});

function RouteComponent() {
	const { cardId } = Route.useParams();
	const typedCardId = cardId as Id<"cards">;
	const data = useQuery(api.cards.get, { cardId: typedCardId });
	const whiteboards = useQuery(api.whiteboards.listActive);
	const archiveCard = useMutation(api.cards.archiveCard);
	const appendToWhiteboard = useMutation(api.cards.appendToWhiteboard);
	const navigate = useNavigate();

	const [deleteOpen, setDeleteOpen] = useState(false);
	const [appendOpen, setAppendOpen] = useState(false);

	if (data === undefined) {
		return <CardEditorShell label="Loading card..." />;
	}

	if (data === null) {
		return <CardEditorShell label="Card not found." />;
	}

	const isOrphan = data.placements.length === 0;
	const whiteboardTitleById = new Map(
		(whiteboards ?? []).map((whiteboard) => [whiteboard._id, whiteboard.title]),
	);

	const handleDelete = async () => {
		await archiveCard({ cardId: typedCardId });
		setDeleteOpen(false);
		if (isOrphan) {
			navigate({ to: "/cards/orphans" });
		} else if (data.boardWhiteboardId) {
			navigate({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: data.boardWhiteboardId },
			});
		} else {
			navigate({ to: "/whiteboard" });
		}
	};

	const handleAppend = async (whiteboardId: Id<"whiteboards">) => {
		const placement = await appendToWhiteboard({ cardId: typedCardId, whiteboardId });
		setAppendOpen(false);

		if (!placement) return;

		navigate({
			to: "/whiteboard/$whiteboardId",
			params: { whiteboardId: placement.whiteboardId },
			search: { focus: placement.shapeId },
		});
	};

	return (
		<main className="bg-[var(--card)] min-h-screen">
			<header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-[var(--card)] px-4 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<SidebarOpenButton />
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-[var(--sea-ink)]">
							{data.card.derivedTitle || "Untitled card"}
						</p>
					</div>
				</div>

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
						<Button variant="destructive" onClick={handleDelete}>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<section
				className="w-full px-4 py-12"
				style={{ maxWidth: CARD_EDITOR_MAX_WIDTH, marginInline: "auto" }}
			>
				<CardEditorPane
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
			</section>
		</main>
	);
}

function CardEditorShell({ label }: { label: string }) {
	return (
		<main className="grid min-h-screen place-items-center p-3 bg-[var(--card)]">
			<div className="rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--sea-ink)]">
				{label}
			</div>
		</main>
	);
}
