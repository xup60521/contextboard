import { useApplicationRuntime } from "@contextboard/application";
import { ChevronDown, Link2 } from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePassThroughWheelEvents } from "tldraw";
import { useWhiteboardNavigation } from "./navigation";
import { WhiteboardCardContext } from "./WhiteboardCardContext";

type Backlink = { cardId: string; title: string; preview: string };

export function WhiteboardBacklinksPanel() {
	const { whiteboards } = useApplicationRuntime();
	const navigation = useWhiteboardNavigation();
	const whiteboardId = useContext(WhiteboardCardContext);
	const ref = useRef<HTMLElement>(null!);
	usePassThroughWheelEvents(ref);
	const [expanded, setExpanded] = useState(false);
	const [backlinks, setBacklinks] = useState<Backlink[]>([]);

	const load = useCallback(async () => {
		if (!whiteboardId) return;
		setBacklinks((await whiteboards?.listBacklinks(whiteboardId)) ?? []);
	}, [whiteboardId, whiteboards]);

	useEffect(() => {
		if (!whiteboardId || !whiteboards) return;
		void load();
		return whiteboards.subscribe(() => void load(), {
			backlinksToWhiteboardId: whiteboardId,
		});
	}, [load, whiteboardId, whiteboards]);

	if (!whiteboardId) return null;

	return (
		<section
			ref={ref}
			className="pointer-events-auto mr-2 w-[148px] max-w-[148px] rounded-[var(--radius-3)] bg-[var(--color-panel)] p-2 text-[var(--color-text)] shadow-[var(--shadow-2)]"
		>
			<button
				type="button"
				className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-semibold hover:bg-[var(--accent)]"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
			>
				<Link2 className="size-3.5 text-[var(--muted-foreground)]" />
				<span>Backlinks ({backlinks.length})</span>
				<ChevronDown className={`ml-auto size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
			</button>
			{expanded ? (
				<div className="mt-1 max-h-64 space-y-px overflow-y-auto">
					{backlinks.length === 0 ? (
						<p className="px-2 py-2 text-xs text-[var(--muted-foreground)]">No backlinks yet</p>
					) : (
						backlinks.map((backlink) => {
							const href = navigation.cardHref(backlink.cardId);
							return (
								<a
									key={backlink.cardId}
									{...navigation.linkProps(href)}
									className="block rounded-md px-2 py-1.5 hover:bg-[var(--accent)]"
								>
									<span className="block truncate text-xs font-medium">{backlink.title}</span>
									{backlink.preview ? <span className="block truncate text-[10px] text-[var(--muted-foreground)]">{backlink.preview}</span> : null}
								</a>
							);
						})
					)}
				</div>
			) : null}
		</section>
	);
}
