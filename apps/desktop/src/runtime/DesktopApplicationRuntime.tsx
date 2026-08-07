import {
	type ApplicationRuntime,
	ApplicationRuntimeProvider,
	ApplicationSyncStatusProvider,
	createRepositoryCanvasService,
	createRepositoryCardRelationsService,
	createRepositoryCardsService,
	createRepositorySearchService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { DesktopAgentBridge } from "./DesktopAgentBridge";
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
			relations: createRepositoryCardRelationsService(repository),
			search: createRepositorySearchService(repository),
			whiteboards: createRepositoryWhiteboardsService(repository, {
				workspaceId,
			}),
			canvas: createRepositoryCanvasService(repository, { workspaceId }),
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
		} satisfies ApplicationRuntime;
	}, [repository, router, workspaceId]);

	const syncStatus = useMemo(
		() => ({
			state: desktopSync.state,
			message: desktopSync.message,
		}),
		[desktopSync.message, desktopSync.state],
	);

	if (!capabilities || !capabilities.whiteboards || !capabilities.canvas)
		return null;

	return (
		<ApplicationSyncStatusProvider value={syncStatus}>
			<ApplicationRuntimeProvider runtime={capabilities}>
				<DesktopAgentBridge
					cards={capabilities.cards}
					whiteboards={capabilities.whiteboards}
					canvas={capabilities.canvas}
					relations={capabilities.relations}
				/>
				{children}
			</ApplicationRuntimeProvider>
		</ApplicationSyncStatusProvider>
	);
}
