import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/test/")({
	component: RouteComponent,
});

const TEST_ROUTES = [
	{
		to: "/test/markdown" as const,
		label: "Markdown editor",
		description: "TipTap rich-text editor with slash commands and KaTeX math.",
	},
	{
		to: "/test/static-renderer" as const,
		label: "Editor vs static renderer",
		description: "Side-by-side comparison of the full editor runtime and the static renderer.",
	},
	{
		to: "/test/markdown-in-whiteboard" as const,
		label: "Markdown in whiteboard",
		description: "Editable markdown cards placed on a tldraw canvas.",
	},
	{
		to: "/test/whiteboard-in-whiteboard" as const,
		label: "Whiteboard in whiteboard",
		description: "Text cards on a tldraw whiteboard.",
	},
] as const;

function RouteComponent() {
	return (
		<main className="page-wrap py-10">
			<header className="mb-6">
				<p className="island-kicker">Test bed</p>
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
					Test routes
				</h1>
				<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
					Pages for testing individual features and integrations.
				</p>
			</header>

			<ul className="grid gap-4 sm:grid-cols-2">
				{TEST_ROUTES.map((route) => (
					<li key={route.to}>
						<Link
							to={route.to}
							className="island-shell block rounded-2xl p-5 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--lagoon)]"
						>
							<h2 className="text-base font-semibold text-[var(--sea-ink)]">
								{route.label}
							</h2>
							<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
								{route.description}
							</p>
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}
