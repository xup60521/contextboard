import { createFileRoute } from "@tanstack/react-router";
import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";

export const Route = createFileRoute("/test/subwhiteboard/$subwhiteboardid")({
	component: RouteComponent,
});

function RouteComponent() {
	const { subwhiteboardid } = Route.useParams();

	return (
		<main className="flex h-[calc(100dvh-80px)] min-h-[620px] w-full flex-col gap-3 p-3">
			<div className="flex min-h-9 items-center justify-between rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2">
				<h1 className="m-0 text-sm font-bold text-[var(--sea-ink)]">
					Sub-whiteboard:{" "}
					<span className="font-mono text-xs text-[var(--lagoon-deep)]">
						{subwhiteboardid}
					</span>
				</h1>
			</div>
			<div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--line)] bg-white shadow-[0_18px_38px_rgba(23,58,64,0.12)]">
				<Tldraw
					persistenceKey={`contextboard-subwhiteboard-${subwhiteboardid}`}
				/>
			</div>
		</main>
	);
}
