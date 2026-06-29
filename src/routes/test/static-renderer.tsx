import { createFileRoute, Link } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import { useState } from "react";
import { RichTextEditor } from "#/components/editor/RichTextEditor";
import { StaticRichTextRenderer } from "#/components/editor/static-renderer";
import { STATIC_RENDERER_FULL_FIXTURE } from "#/components/editor/static-renderer/staticRendererFixtures";

export const Route = createFileRoute("/test/static-renderer")({
	component: RouteComponent,
});

function RouteComponent() {
	const [doc, setDoc] = useState<JSONContent>(STATIC_RENDERER_FULL_FIXTURE);

	return (
		<main className="page-wrap py-10">
			<section className="island-shell overflow-hidden rounded-[2rem]">
				<header className="border-b border-[var(--line)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--lagoon) 12%,var(--surface)),color-mix(in_oklab,var(--lagoon-deep) 9%,var(--surface-strong)))] px-5 py-5 sm:px-7 sm:py-6">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div className="max-w-3xl">
							<p className="island-kicker mb-2">Test bed</p>
							<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
								Editor vs static renderer
							</h1>
							<p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sea-ink-soft)] sm:text-base">
								The left pane is the full TipTap editor runtime. The right pane is
								the static renderer using the same JSON document. Edit the left
								side to verify that both surfaces stay visually aligned.
							</p>
						</div>

						<div className="flex flex-wrap gap-2">
							<span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink)]">
								Live sync
							</span>
							<span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink)]">
								Shared JSON
							</span>
							<button
								type="button"
								className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink)] transition hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon)]"
								onClick={() => setDoc(STATIC_RENDERER_FULL_FIXTURE)}
							>
								Reset content
							</button>
						</div>
					</div>
				</header>

				<div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
					<ComparisonPanel
						accentClassName="border-l-[var(--lagoon)]"
						title="Feature-rich editor"
						description="Editable TipTap surface with the full runtime and plugin stack."
						badgeLabel="Editable"
					>
						<RichTextEditor
							content={doc}
							onChange={setDoc}
							className="notion-editor seamless h-full"
							contentClassName="min-h-[60vh] bg-[var(--bg-base)]"
						/>
					</ComparisonPanel>

					<ComparisonPanel
						accentClassName="border-l-[var(--lagoon-deep)]"
						title="Static renderer"
						description="Pure renderer output from the same TipTap JSON."
						badgeLabel="No editor runtime"
					>
						<StaticRichTextRenderer
							content={doc}
							className="h-full"
							contentClassName="min-h-[60vh] bg-[var(--bg-base)]"
						/>
					</ComparisonPanel>
				</div>

				<div className="border-t border-[var(--line)] px-5 py-4 sm:px-7">
					<div className="flex flex-col gap-2 text-sm text-[var(--sea-ink-soft)] sm:flex-row sm:items-center sm:justify-between">
						<p>
							Use the left pane for editing. The right pane should match the
							content, minus editor chrome and ProseMirror runtime behavior.
						</p>
						<Link
							to="/test"
							className="font-semibold text-[var(--lagoon-deep)] hover:text-[var(--lagoon)]"
						>
							Back to test routes
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}

type ComparisonPanelProps = {
	title: string;
	description: string;
	accentClassName: string;
	badgeLabel: string;
	children: ReactNode;
};

function ComparisonPanel({
	title,
	description,
	accentClassName,
	badgeLabel,
	children,
}: ComparisonPanelProps) {
	return (
		<section className="flex min-h-[76vh] flex-col overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_10px_24px_rgba(23,58,64,0.06)]">
			<div
				className={`flex items-start justify-between gap-4 border-l-4 border-b border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 ${accentClassName}`}
			>
				<div>
					<h2 className="text-sm font-bold text-[var(--sea-ink)]">{title}</h2>
					<p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
						{description}
					</p>
				</div>
				<span className="mt-0.5 rounded-full bg-[var(--bg-base)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sea-ink-soft)]">
					{badgeLabel}
				</span>
			</div>

			<div className="min-h-0 flex-1 p-4">{children}</div>
		</section>
	);
}
