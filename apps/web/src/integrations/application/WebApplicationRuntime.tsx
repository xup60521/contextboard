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
import { useLocalDatabase } from "../local/provider";
import { useSyncRuntime } from "../sync/provider";
import { getWebWorkspaceRepository } from "./repository";
import { createWebFileRuntime } from "./webFileRuntime";

export function WebApplicationRuntime({ children }: { children: ReactNode }) {
	const local = useLocalDatabase();
	const sync = useSyncRuntime();
	const router = useRouter();
	const database = local.status === "ready" ? local.database : null;
	const workspaceId = local.status === "ready" ? local.workspaceId : null;
	const deviceId = local.status === "ready" ? local.deviceId : null;

	const runtime = useMemo<ApplicationRuntime | null>(() => {
		if (!database || workspaceId === null || deviceId === null) return null;
		const repository = getWebWorkspaceRepository(database);
		return {
			platform: "web",
			workspaceId,
			cards: createRepositoryCardsService(repository, {
				deviceId,
			}),
			relations: createRepositoryCardRelationsService(repository, {
				deviceId,
			}),
			whiteboards: createRepositoryWhiteboardsService(repository, {
				deviceId,
			}),
			canvas: createRepositoryCanvasService(repository, {
				deviceId,
				workspaceId,
			}),
			search: createRepositorySearchService(repository),
			files: createWebFileRuntime(repository, deviceId),
			navigation: {
				cardsHref: () => "/cards?orphan=&sort=title&q=",
				cardHref: (cardId) => `/cards/${encodeURIComponent(cardId)}`,
				rootWhiteboardHref: () => "/whiteboard",
				whiteboardHref: (id, options) =>
					`/whiteboard/${encodeURIComponent(id)}${
						options?.focus ? `?focus=${encodeURIComponent(options.focus)}` : ""
					}`,
				navigate: (href) => router.history.push(href),
				replace: (href) => router.history.replace(href),
			},
		};
	}, [database, deviceId, router, workspaceId]);
	const syncStatus = useMemo(
		() => ({ state: sync.state.state, message: sync.state.error }),
		[sync.state.error, sync.state.state],
	);

	if (!runtime) return null;

	return (
		<ApplicationSyncStatusProvider value={syncStatus}>
			<ApplicationRuntimeProvider runtime={runtime}>
				{children}
			</ApplicationRuntimeProvider>
		</ApplicationSyncStatusProvider>
	);
}
