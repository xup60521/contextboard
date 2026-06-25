import { createFileRoute, Link } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useQuery } from "convex/react";
import { CardEditorPane } from "#/components/editor/CardEditorPane";
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
						Back to orphan cards
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

			<section
            // className="island-shell rounded-2xl p-6 sm:p-8"
            >
				<CardEditorPane
					cardId={data.card._id}
					content={data.card.content as JSONContent}
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
