import { ExternalLink, Eye, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import type { Id } from "./ids";
import { useWhiteboardNavigation } from "./navigation";
import { WhiteboardCanvas } from "./WhiteboardCanvas";

export function WhiteboardPreviewDialog({
	whiteboardId,
	onClose,
}: {
	whiteboardId: string | null;
	onClose: () => void;
}) {
	const navigation = useWhiteboardNavigation();

	return (
		<Dialog
			open={whiteboardId !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				className="h-[min(88vh,900px)] w-[min(94vw,1440px)] max-w-none grid-rows-[3rem_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(94vw,1440px)]"
				showCloseButton={false}
				overlayProps={{
					onPointerDown: (event) => {
						event.stopPropagation();
						onClose();
					},
				}}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
				onPointerDownOutside={(event) => {
					event.preventDefault();
					onClose();
				}}
				onEscapeKeyDown={(event) => {
					event.stopPropagation();
					onClose();
				}}
			>
				<DialogTitle className="sr-only">Whiteboard preview</DialogTitle>
				<div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4">
					<div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)]">
						<Eye className="size-3.5" />
						<span>Read only</span>
					</div>
					<div className="ml-auto flex items-center gap-2">
						<button
							type="button"
							className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-xs font-semibold text-[var(--card-foreground)] transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
							onClick={() => {
								if (!whiteboardId) return;
								onClose();
								navigation.openWhiteboard(whiteboardId);
							}}
						>
							<ExternalLink className="size-3.5" />
							Open whiteboard
						</button>
						<button
							type="button"
							className="inline-flex size-8 items-center justify-center rounded-md text-lg leading-none text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--card-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
							aria-label="Close whiteboard preview"
						>
							<X className="size-4" />
						</button>
					</div>
				</div>
				<div className="min-h-0 flex-1">
					{whiteboardId ? (
						<WhiteboardCanvas
							key={whiteboardId}
							whiteboardId={whiteboardId as Id<"whiteboards">}
							mode="preview"
						/>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
