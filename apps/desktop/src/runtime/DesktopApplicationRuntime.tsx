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
			navigation: {
				cardsHref: () => "/cards",
				cardHref: (cardId) => `/cards/${encodeURIComponent(cardId)}`,
				navigate: (href) => router.history.push(href),
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
