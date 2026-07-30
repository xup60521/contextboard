import {
	type ApplicationRuntime,
	ApplicationRuntimeProvider,
	createRepositoryCanvasService,
	createRepositoryCardsService,
	createRepositoryWhiteboardsService,
	type SyncRuntime,
} from "@contextboard/application";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useDesktopRuntime } from "./DesktopRuntimeProvider";
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
	const router = useRouter();

	const runtime = useMemo<ApplicationRuntime | null>(() => {
		if (desktop.status !== "ready") return null;
		const sync: SyncRuntime = { state: "local-only", message: "Local only" };
		return {
			platform: "desktop",
			workspaceId: desktop.workspaceId,
			cards: createRepositoryCardsService(desktop.repository),
			whiteboards: createRepositoryWhiteboardsService(desktop.repository),
			canvas: createRepositoryCanvasService(desktop.repository),
			files: createDesktopFileRuntime(desktop.repository),
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
			sync,
		};
	}, [desktop, router]);

	if (!runtime) return null;

	return (
		<ApplicationRuntimeProvider runtime={runtime}>
			{children}
		</ApplicationRuntimeProvider>
	);
}
