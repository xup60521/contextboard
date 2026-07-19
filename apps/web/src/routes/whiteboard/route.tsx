import { createFileRoute, useParams } from "@tanstack/react-router";
import { WhiteboardCanvas } from "#/components/whiteboard/WhiteboardCanvas";
import type { Id } from "#/integrations/local/types";

type WhiteboardSearch = {
	/** tldraw shape id to select & zoom to once the board hydrates. */
	focus?: string;
};

export const Route = createFileRoute("/whiteboard")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): WhiteboardSearch => ({
		focus: typeof search.focus === "string" ? search.focus : undefined,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	// Read the active whiteboard id loosely from the matched child route so a
	// single persistent <WhiteboardCanvas> (and thus tldraw editor) survives
	// navigation between the root list and any board. Only the prop changes.
	const { whiteboardId } = useParams({ strict: false });
	const { focus } = Route.useSearch();

	return (
		<WhiteboardCanvas
			whiteboardId={(whiteboardId as Id<"whiteboards"> | undefined) ?? null}
			focusShapeId={focus ?? null}
		/>
	);
}
