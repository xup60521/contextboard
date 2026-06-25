import { createFileRoute, Link } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { RichTextEditor } from "#/components/editor/RichTextEditor";
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
	const updateContent = useMutation(api.cards.updateContent);
	const pendingContentRef = useRef<JSONContent | null>(null);
	const saveTimerRef = useRef<number | null>(null);

	const flushSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const content = pendingContentRef.current;
		pendingContentRef.current = null;
		if (!content) return;

		void updateContent({
			cardId: typedCardId,
			content,
		});
	}, [typedCardId, updateContent]);

	const scheduleSave = useCallback(
		(content: JSONContent) => {
			pendingContentRef.current = content;

			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}

			saveTimerRef.current = window.setTimeout(flushSave, 450);
		},
		[flushSave],
	);

	useEffect(() => {
		return () => {
			flushSave();
		};
	}, [flushSave]);

	if (data === undefined) {
		return <CardEditorShell label="Loading card..." />;
	}

	if (data === null) {
		return <CardEditorShell label="Card not found." />;
	}

	return (
		<main className="page-wrap py-6">
			<header className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<nav className="flex min-w-0 items-center gap-2 text-sm">
					<Link
						to="/whiteboard"
						className="truncate font-semibold text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
					>
						Root
					</Link>
					{data.whiteboard === null && (
						<>
							<span className="text-[var(--sea-ink-soft)]">/</span>
							<Link
								to="/cards/orphans"
								className="truncate font-semibold text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
							>
								Orphan cards
							</Link>
						</>
					)}
					{data.breadcrumbs.map((crumb) => (
						<span key={crumb._id} className="flex min-w-0 items-center gap-2">
							<span className="text-[var(--sea-ink-soft)]">/</span>
							<Link
								to="/whiteboard/$whiteboardId"
								params={{ whiteboardId: crumb._id }}
								className="truncate font-semibold text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
							>
								{crumb.title}
							</Link>
						</span>
					))}
				</nav>
				{data.whiteboard ? (
					<Link
						to="/whiteboard/$whiteboardId"
						params={{ whiteboardId: data.whiteboard._id }}
						className="rounded border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
					>
						Back to whiteboard
					</Link>
				) : (
					<Link
						to="/cards/orphans"
						className="rounded border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
					>
						Back to orphan cards
					</Link>
				)}
			</header>

			<section className="island-shell rounded-2xl p-6 sm:p-8">
				<RichTextEditor
					key={data.card._id}
					content={data.card.content as JSONContent}
					onChange={scheduleSave}
				/>
			</section>
		</main>
	);
}

function CardEditorShell({ label }: { label: string }) {
	return (
		<main className="grid h-[calc(100dvh-80px)] min-h-[620px] place-items-center p-3">
			<div className="rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--sea-ink)]">
				{label}
			</div>
		</main>
	);
}
