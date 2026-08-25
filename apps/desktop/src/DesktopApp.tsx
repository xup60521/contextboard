import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createDesktopRouter, type DesktopRouter } from "./router";
import {
	DesktopRuntimeProvider,
	type DesktopRuntimeProviderProps,
} from "./runtime/DesktopRuntimeProvider";
import { DesktopSyncProvider } from "./runtime/DesktopSyncProvider";
import { useFullscreenShortcut } from "./runtime/useFullscreenShortcut";

export type DesktopAppProps = {
	invoke?: DesktopRuntimeProviderProps["invoke"];
	router?: DesktopRouter;
};

export function DesktopApp({ invoke, router }: DesktopAppProps = {}) {
	const [instance] = useState(() => router ?? createDesktopRouter());
	useFullscreenShortcut();

	return (
		<DesktopRuntimeProvider invoke={invoke}>
			<DesktopSyncProvider invoke={invoke}>
				<RouterProvider router={instance} />
			</DesktopSyncProvider>
		</DesktopRuntimeProvider>
	);
}
