import {
	type ApplicationRuntime,
	ApplicationRuntimeProvider,
	createRepositoryCanvasService,
	createRepositoryCardsService,
	createRepositorySearchService,
	createRepositoryWhiteboardsService,
	type SyncRuntime,
} from "@contextboard/application";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useDesktopRuntime } from "./DesktopRuntimeProvider";
import { useDesktopSync } from "./DesktopSyncProvider";
import { createDesktopFileRuntime } from "./desktopFileRuntime";

/**
 * Desktop composition root. It injects the SQLite-backed repository and a
 * hash-history navigator into the shared application UI; the shared UI never
 * learns that this platform is Tauri.
 */
export function DesktopApplicationRuntime({
	children,
}: {
	children: ReactNode;
}) {
	const desktop = useDesktopRuntime();
	const desktopSync = useDesktopSync();
	const router = useRouter();

	const repository = desktop.status === "ready" ? desktop.repository : null;
	const workspaceId = desktop.status === "ready" ? desktop.workspaceId : null;

	// Services are memoized on the repository alone. Shared views key their reads
	// on `runtime.cards` and friends, so rebuilding these on every sync status
	// change would refetch the whole page a few times a second.
	const capabilities = useMemo(() => {
		if (!repository || workspaceId === null) return null;
		return {
			platform: "desktop",
			workspaceId,
			cards: createRepositoryCardsService(repository),
			search: createRepositorySearchService(repository),
			whiteboards: createRepositoryWhiteboardsService(repository),
			canvas: createRepositoryCanvasService(repository),
			files: createDesktopFileRuntime(repository),
			navigation: {
				cardsHref: () => "/cards",
				cardHref: (cardId) => `/cards/${encodeURIComponent(cardId)}`,
				rootWhiteboardHref: () => "/whiteboard",
				whiteboardHref: (id, whiteboardOptions) =>
					`/whiteboard/${encodeURIComponent(id)}${
						whiteboardOptions?.focus
							? `?focus=${encodeURIComponent(whiteboardOptions.focus)}`
							: ""
					}`,
				navigate: (href) => router.history.push(href),
				replace: (href) => router.history.replace(href),
				// Desktop runs on hash history: a bare `/whiteboard` href would
				// leave the SPA and reload at `/`, which redirects to the card
				// library.
				hrefAttribute: (href) => `#${href}`,
			},
		} satisfies Omit<ApplicationRuntime, "sync">;
	}, [repository, router, workspaceId]);

	// Only the sync status rides on the runtime object identity.
	const runtime = useMemo<ApplicationRuntime | null>(() => {
		if (!capabilities) return null;
		const sync: SyncRuntime = {
			state: desktopSync.state,
			message: desktopSync.message,
		};
		return { ...capabilities, sync };
	}, [capabilities, desktopSync.message, desktopSync.state]);

	if (!runtime) return null;

	return (
		<ApplicationRuntimeProvider runtime={runtime}>
			{children}
		</ApplicationRuntimeProvider>
	);
}
