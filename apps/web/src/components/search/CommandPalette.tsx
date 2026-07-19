import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useQuery } from "convex/react";
import { FileText, Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReadonlyRichTextPreview } from "#/components/editor/ReadonlyRichTextPreview";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import { Dialog, DialogContent } from "#/components/ui/dialog";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
	CardSearchResult,
	WhiteboardSearchResult,
} from "../../../convex/search";
import { CardPreviewDialog } from "./CardPreviewDialog";

type Mode = "global" | "local";

type ActiveResult =
	| { kind: "card"; data: CardSearchResult }
	| { kind: "whiteboard"; data: WhiteboardSearchResult };

function cardValue(card: CardSearchResult) {
	return `card-${card.id}`;
}

function whiteboardValue(whiteboard: WhiteboardSearchResult) {
	return `whiteboard-${whiteboard.id}`;
}

export function CommandPalette() {
	const navigate = useNavigate();
	const params = useParams({ strict: false });
	const currentWhiteboardId =
		(params.whiteboardId as Id<"whiteboards"> | undefined) ?? null;

	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>("global");
	const [query, setQuery] = useState("");
	const [debouncedQuery] = useDebouncedValue(query, { wait: 150 });
	const [activeValue, setActiveValue] = useState("");
	const [previewCardId, setPreviewCardId] = useState<Id<"cards"> | null>(null);

	// Global hotkeys: Ctrl/Cmd+O = global search, Ctrl/Cmd+P = search within the
	// current whiteboard. Capture phase + stopPropagation so the keys reach us
	// before tldraw's canvas handlers and before the browser's native shortcuts.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			const key = event.key.toLowerCase();
			if (key !== "o" && key !== "p") return;

			event.preventDefault();
			event.stopPropagation();

			if (key === "o") {
				setMode("global");
			} else {
				setMode(currentWhiteboardId ? "local" : "global");
			}
			setOpen(true);
		};

		window.addEventListener("keydown", handler, { capture: true });
		return () =>
			window.removeEventListener("keydown", handler, { capture: true });
	}, [currentWhiteboardId]);

	const isLocal = mode === "local" && currentWhiteboardId !== null;

	const globalResults = useQuery(
		api.search.searchGlobal,
		open && !isLocal ? { term: debouncedQuery } : "skip",
	);
	const localResults = useQuery(
		api.search.searchInWhiteboard,
		open && isLocal && currentWhiteboardId
			? { whiteboardId: currentWhiteboardId, term: debouncedQuery }
			: "skip",
	);
	const results = isLocal ? localResults : globalResults;

	const whiteboards = useMemo(() => results?.whiteboards ?? [], [results]);
	const cards = useMemo(() => results?.cards ?? [], [results]);
	const hasResults = cards.length > 0 || whiteboards.length > 0;

	// Map each cmdk value to its result, in the same order the list renders them,
	// so we can resolve the highlighted item for the preview pane.
	const resultByValue = useMemo(() => {
		const map = new Map<string, ActiveResult>();
		for (const whiteboard of whiteboards) {
			map.set(whiteboardValue(whiteboard), {
				kind: "whiteboard",
				data: whiteboard,
			});
		}
		for (const card of cards) {
			map.set(cardValue(card), { kind: "card", data: card });
		}
		return map;
	}, [whiteboards, cards]);

	// Keep the highlighted value valid as results change (cmdk is controlled).
	useEffect(() => {
		if (resultByValue.size === 0) {
			if (activeValue !== "") setActiveValue("");
			return;
		}
		if (!resultByValue.has(activeValue)) {
			setActiveValue(resultByValue.keys().next().value ?? "");
		}
	}, [resultByValue, activeValue]);

	// Debounce which item the preview pane renders. The left-list highlight
	// updates instantly (cmdk), but mounting the rich-text editor is expensive,
	// so we only render it once the selection settles to avoid lag while arrowing.
	const [previewValue] = useDebouncedValue(activeValue, { wait: 120 });

	const close = useCallback(() => {
		setOpen(false);
	}, []);

	const openCardPreview = useCallback(
		(card: CardSearchResult) => {
			close();
			setPreviewCardId(card.id);
		},
		[close],
	);

	const openWhiteboard = useCallback(
		(whiteboard: WhiteboardSearchResult) => {
			close();
			void navigate({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: whiteboard.id },
			});
		},
		[close, navigate],
	);

	const previewResult =
		resultByValue.get(previewValue) ?? resultByValue.get(activeValue) ?? null;

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!next) close();
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="overflow-hidden p-0 sm:max-w-3xl"
				>
					<Command
						shouldFilter={false}
						value={activeValue}
						onValueChange={setActiveValue}
						className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
					>
						<CommandInput
							autoFocus
							value={query}
							onValueChange={setQuery}
							placeholder={
								isLocal
									? "Search cards & sub-whiteboards on this board…"
									: "Search all cards & whiteboards…"
							}
						/>
						<div className="flex h-[24rem]">
							<CommandList className="max-h-none w-1/2 shrink-0 overflow-y-auto border-r border-border">
								{!hasResults && (
									<CommandEmpty>
										{debouncedQuery.trim().length === 0 && !isLocal
											? "Type to search…"
											: "No results found."}
									</CommandEmpty>
								)}

								{whiteboards.length > 0 && (
									<CommandGroup heading="Whiteboards">
										{whiteboards.map((whiteboard) => (
											<CommandItem
												key={whiteboard.id}
												value={whiteboardValue(whiteboard)}
												onSelect={() => openWhiteboard(whiteboard)}
												className="gap-2"
											>
												<Layers className="size-4" />
												<span className="truncate">
													{whiteboard.title || "Untitled whiteboard"}
												</span>
											</CommandItem>
										))}
									</CommandGroup>
								)}

								{cards.length > 0 && (
									<CommandGroup heading="Cards">
										{cards.map((card) => (
											<CommandItem
												key={card.id}
												value={cardValue(card)}
												onSelect={() => openCardPreview(card)}
												className="gap-2"
											>
												<FileText className="size-4" />
												<span className="flex min-w-0 flex-1 flex-col">
													<span className="truncate font-medium">
														{card.title || "Untitled card"}
													</span>
													{card.preview ? (
														<span className="truncate text-xs text-muted-foreground">
															{card.preview}
														</span>
													) : null}
												</span>
											</CommandItem>
										))}
									</CommandGroup>
								)}
							</CommandList>

							<div className="w-1/2 overflow-y-auto">
								<PreviewPane result={previewResult} />
							</div>
						</div>
					</Command>
				</DialogContent>
			</Dialog>

			<CardPreviewDialog
				cardId={previewCardId}
				currentWhiteboardId={currentWhiteboardId}
				onClose={() => setPreviewCardId(null)}
			/>
		</>
	);
}

function PreviewPane({ result }: { result: ActiveResult | null }) {
	if (!result) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
				Select an item to preview.
			</div>
		);
	}

	if (result.kind === "whiteboard") {
		return (
			<div className="grid h-full place-items-center gap-2 p-6 text-center">
				<div className="flex flex-col items-center gap-2">
					<Layers className="size-5 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">
						Press Enter to open this whiteboard.
					</p>
				</div>
			</div>
		);
	}

	return <CardPreview card={result.data} />;
}

function CardPreview({ card }: { card: CardSearchResult }) {
	return (
		<div className="p-5">
			<ReadonlyRichTextPreview
				content={card.content as JSONContent}
				contentClassName="min-h-0 bg-transparent text-sm"
			/>
		</div>
	);
}
