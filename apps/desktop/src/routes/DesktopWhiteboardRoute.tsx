import { WhiteboardCanvas } from "@contextboard/web-ui";
import { useSearch } from "@tanstack/react-router";

function useFocusShapeId() {
	const search = useSearch({ strict: false }) as { focus?: string };
	return search.focus ?? null;
}

/** `/whiteboard/$whiteboardId` — a specific board. */
export function DesktopWhiteboardRoute({
	whiteboardId,
}: {
	whiteboardId: string;
}) {
	const focusShapeId = useFocusShapeId();
	return (
		<WhiteboardCanvas
			whiteboardId={whiteboardId}
			focusShapeId={focusShapeId}
		/>
	);
}

/**
 * `/whiteboard` — the root board.
 *
 * The root board is the `null` whiteboard, not a whiteboard entity: it holds
 * only the top-level subwhiteboard links, and the canvas refuses to create
 * cards on it. Materialising a real board here would silently turn the root
 * into an ordinary whiteboard that accepts cards.
 */
export function DesktopRootWhiteboardRoute() {
	const focusShapeId = useFocusShapeId();
	return <WhiteboardCanvas whiteboardId={null} focusShapeId={focusShapeId} />;
}
