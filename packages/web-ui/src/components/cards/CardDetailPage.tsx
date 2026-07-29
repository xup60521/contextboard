import {
	type CardDetail,
	useApplicationRuntime,
} from "@contextboard/application";
import type { JSONContent } from "@tiptap/core";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { CardDetailDocumentSurface } from "./CardDetailDocumentSurface";
import { CardInfoSection } from "./CardInfoSection";

const CARD_EDITOR_MAX_WIDTH = 900;

export function CardDetailPage({ cardId }: { cardId: string }) {
	const runtime = useApplicationRuntime();
	const [data, setData] = useState<CardDetail | null | undefined>();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [appendOpen, setAppendOpen] = useState(false);

	useEffect(() => {
		let active = true;
		setData(undefined);
		const load = () => runtime.cards.get(cardId).then((value) => active && setData(value));
		void load();
		const unsubscribe = runtime.cards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [cardId, runtime.cards]);
	useEffect(() => {
		setDeleteOpen(false);
		setAppendOpen(false);
		const scrollHost =
			runtime.ui?.resolveScrollHost?.() ??
			document.querySelector<HTMLElement>("[data-app-scroll-host='true']");
		if (typeof scrollHost?.scrollTo === "function") {
			scrollHost.scrollTo({ top: 0 });
		}
	}, [cardId, runtime.ui]);

	const whiteboardTitleById = useMemo(
		() =>
			new Map(
				(data?.breadcrumbs ?? []).map((entry) => [entry.id, entry.title]),
			),
		[data?.breadcrumbs],
	);
	const handleDelete = async () => {
		if (!data) return;
		await runtime.cards.delete(cardId);
		setDeleteOpen(false);
		runtime.navigation.navigate(
			data.boardWhiteboardId
				? runtime.navigation.whiteboardHref(data.boardWhiteboardId)
				: runtime.navigation.cardsHref(),
		);
	};
	const handleAppend = async (whiteboardId: string) => {
		const placement = await runtime.cards.appendToWhiteboard({ cardId, whiteboardId });
		setAppendOpen(false);
		if (placement)
			runtime.navigation.navigate(
				runtime.navigation.whiteboardHref(whiteboardId, { focus: placement.shapeId }),
			);
	};

	return (
		<main className="min-h-screen bg-[var(--card)]" data-testid="card-detail-page">
			<header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-[var(--card)] px-4 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<SidebarOpenButton />
					{data === undefined ? (
						<div className="h-4 w-32 rounded bg-[var(--line)]" data-testid="card-detail-title-skeleton" />
					) : (
						<p className="truncate text-sm font-semibold text-[var(--sea-ink)]">
							{data?.title || "Untitled card"}
						</p>
					)}
				</div>
				{data ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-sm" aria-label="Card actions"><MoreHorizontal className="size-5" /></Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => setAppendOpen(true)}>Place on whiteboard...</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-red-500"><Trash2 className="size-4" />Delete card</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				) : <div className="h-9 w-9 rounded-md bg-[var(--line)]" />}
			</header>
			<WhiteboardPickerDialog open={appendOpen} onOpenChange={setAppendOpen} onSelect={(id) => void handleAppend(id)} />
			<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<DialogContent>
					<DialogHeader><DialogTitle>Delete card</DialogTitle><DialogDescription>Are you sure you want to delete this card? This action cannot be undone.</DialogDescription></DialogHeader>
					<DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" onClick={() => void handleDelete()}>Delete</Button></DialogFooter>
				</DialogContent>
			</Dialog>
			<section className="w-full px-4 py-12" style={{ maxWidth: CARD_EDITOR_MAX_WIDTH, marginInline: "auto" }}>
				{data === undefined ? <CardEditorShell label="Loading card..." /> : data === null ? <CardEditorShell label="Card not found." /> : (
					<>
						<CardDetailDocumentSurface cardId={data.id} content={data.content as JSONContent} version={data.version} whiteboardId={data.boardWhiteboardId} />
						<CardInfoSection placements={data.placements} backlinks={data.backlinks} whiteboardTitleById={whiteboardTitleById} createdAt={data.createdAt} updatedAt={data.updatedAt} plainText={data.preview} />
					</>
				)}
			</section>
		</main>
	);
}

function CardEditorShell({ label }: { label: string }) {
	return <div className="grid min-h-[60vh] place-items-center p-3" data-testid="card-detail-shell"><div className="rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--sea-ink)]">{label}</div></div>;
}
