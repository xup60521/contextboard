import { useDebouncedValue } from "@tanstack/react-pacer";
import {
	type GlobalCardSearchResult,
	type SearchResults,
	type WhiteboardSearchResult,
	useApplicationRuntime,
	useApplicationValue,
} from "@contextboard/application";
import { ReadonlyRichTextPreview } from "@contextboard/editor";
import type { JSONContent } from "@tiptap/core";
import { FileText, Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { CardPreviewDialog } from "../cards/CardPreviewDialog";

export type CommandPaletteProps = {
	currentWhiteboardId?: string | null;
};

type Mode = "global" | "local";

type ActiveResult =
	| { kind: "card"; data: GlobalCardSearchResult }
	| { kind: "whiteboard"; data: WhiteboardSearchResult };

function cardValue(card: GlobalCardSearchResult) {
	return `card-${card.id}`;
}

function whiteboardValue(whiteboard: WhiteboardSearchResult) {
	return `whiteboard-${whiteboard.id}`;
}

/**
 * Keyboard-first search for cards and whiteboards. The host supplies the
 * current whiteboard because routing is deliberately kept out of shared UI.
 */
export function CommandPalette({
	currentWhiteboardId = null,
}: CommandPaletteProps) {
	const runtime = useApplicationRuntime();
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>("global");
	const [query, setQuery] = useState("");
	const [debouncedQuery] = useDebouncedValue(query, { wait: 150 });
	const [activeValue, setActiveValue] = useState("");
	const [previewCardId, setPreviewCardId] = useState<string | null>(null);

	// Capture before tldraw and native browser handlers so Ctrl/Cmd+O and P are
	// reliable from every focused view in the desktop or web application.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			const key = event.key.toLowerCase();
			if (key !== "o" && key !== "p") return;

			event.preventDefault();
			event.stopPropagation();
		setMode(key === "o" || !currentWhiteboardId ? "global" : "local");
		setOpen(true);
		};

		window.addEventListener("keydown", handler, { capture: true });
		return () =>
			window.removeEventListener("keydown", handler, { capture: true });
	}, [currentWhiteboardId]);

	const isLocal = mode === "local" && currentWhiteboardId !== null;

	const searchState = useApplicationValue<SearchResults>(
		() =>
			open && runtime.search
				? runtime.search.search({
						term: debouncedQuery,
						...(isLocal && currentWhiteboardId
							? { whiteboardId: currentWhiteboardId }
							: {}),
					})
				: Promise.resolve({ cards: [], whiteboards: [] }),
		[open, isLocal, currentWhiteboardId, debouncedQuery, runtime.search],
	);

	const results = searchState.status === "ready" ? searchState.data : null;
	const whiteboards = useMemo(() => results?.whiteboards ?? [], [results]);
	const cards = useMemo(() => results?.cards ?? [], [results]);
	const hasResults = cards.length > 0 || whiteboards.length > 0;

	// Map cmdk's selected value back to the typed result for the preview pane.
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

	useEffect(() => {
		if (resultByValue.size === 0) {
			if (activeValue !== "") setActiveValue("");
			return;
		}
		if (!resultByValue.has(activeValue)) {
			setActiveValue(resultByValue.keys().next().value ?? "");
		}
	}, [resultByValue, activeValue]);

	// Avoid mounting the rich-text preview on every arrow-key event.
	const [previewValue] = useDebouncedValue(activeValue, { wait: 120 });

	const close = useCallback(() => {
		setOpen(false);
	}, []);

	const openCardPreview = useCallback(
		(card: GlobalCardSearchResult) => {
			close();
			setPreviewCardId(card.id);
		},
		[close],
	);

	const openWhiteboard = useCallback(
		(whiteboard: WhiteboardSearchResult) => {
			close();
			runtime.navigation.navigate(
				runtime.navigation.whiteboardHref(whiteboard.id),
			);
		},
		[close, runtime.navigation],
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
				<DialogHeader className="sr-only">
					<DialogTitle>Search Contextboard</DialogTitle>
					<DialogDescription>
						Search cards and whiteboards. Use the arrow keys to navigate and Enter
						to open a result.
					</DialogDescription>
				</DialogHeader>
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
									? "Search cards & sub-whiteboards on this board"
									: "Search all cards & whiteboards"
							}
						/>
						<div className="flex h-[24rem]">
							<CommandList className="max-h-none w-1/2 shrink-0 overflow-y-auto border-r border-border">
								{searchState.status === "loading" && (
									<CommandEmpty>Searching…</CommandEmpty>
								)}
								{searchState.status === "error" && (
									<CommandEmpty>Search is unavailable right now.</CommandEmpty>
								)}
								{searchState.status === "ready" && !hasResults && (
									<CommandEmpty>
										{debouncedQuery.trim().length === 0 && !isLocal
											? "Type to search"
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

function CardPreview({ card }: { card: GlobalCardSearchResult }) {
	return (
		<div className="p-5">
			<ReadonlyRichTextPreview
				content={card.content as JSONContent}
				contentClassName="min-h-0 bg-transparent text-sm"
			/>
		</div>
	);
}
