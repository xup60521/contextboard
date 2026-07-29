import {
	type ApplicationRuntime,
	ApplicationRuntimeProvider,
	createRepositoryCanvasService,
	createRepositoryCardsService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application";
import { IndexedDbWorkspaceRepository } from "@contextboard/storage-indexeddb";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useLocalDatabase } from "../local/provider";
import { useSyncRuntime } from "../sync/provider";
import { createWebFileRuntime } from "./webFileRuntime";

export function WebApplicationRuntime({ children }: { children: ReactNode }) {
	const local = useLocalDatabase();
	const sync = useSyncRuntime();
	const router = useRouter();

	const runtime = useMemo<ApplicationRuntime | null>(() => {
		if (local.status !== "ready") return null;
		const repository = new IndexedDbWorkspaceRepository(local.database);
		return {
			platform: "web",
			workspaceId: local.workspaceId,
			cards: createRepositoryCardsService(repository, {
				deviceId: local.deviceId,
			}),
			whiteboards: createRepositoryWhiteboardsService(repository, {
				deviceId: local.deviceId,
			}),
			canvas: createRepositoryCanvasService(repository, {
				deviceId: local.deviceId,
			}),
			files: createWebFileRuntime(local.database, local.deviceId),
			navigation: {
				cardsHref: () => "/cards?orphan=&sort=title&q=",
				cardHref: (cardId) => `/cards/${encodeURIComponent(cardId)}`,
				rootWhiteboardHref: () => "/whiteboard",
				whiteboardHref: (id, options) =>
					`/whiteboard/${encodeURIComponent(id)}${
						options?.focus
							? `?focus=${encodeURIComponent(options.focus)}`
							: ""
					}`,
				navigate: (href) => router.history.push(href),
				replace: (href) => router.history.replace(href),
			},
			sync: {
				state: sync.state.state,
				message: sync.state.error,
			},
		};
	}, [local, router, sync.state.error, sync.state.state]);

	if (!runtime) return null;

	return (
		<ApplicationRuntimeProvider runtime={runtime}>
			{children}
		</ApplicationRuntimeProvider>
	);
}
