import { useApplicationRuntime } from "@contextboard/application";
import { WhiteboardCanvas } from "@contextboard/web-ui";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
 * `/whiteboard` — the root board. Desktop has no server-side bootstrap, so the
 * first visit creates the root board before handing over to the shared canvas.
 */
export function DesktopRootWhiteboardRoute() {
	const { whiteboards } = useApplicationRuntime();
	const focusShapeId = useFocusShapeId();
	const [rootId, setRootId] = useState<string | null | undefined>();

	useEffect(() => {
		if (!whiteboards) return;
		let active = true;
		const load = async () => {
			const boards = await whiteboards.list();
			const existing = boards
				.filter((board) => board.parentWhiteboardId === null)
				.sort((a, b) => a.createdAt - b.createdAt)[0];
			if (!active) return;
			setRootId(existing ? existing.id : await whiteboards.createRoot());
		};
		void load();
		return () => {
			active = false;
		};
	}, [whiteboards]);

	if (rootId === undefined) return null;
	return (
		<WhiteboardCanvas whiteboardId={rootId} focusShapeId={focusShapeId} />
	);
}
