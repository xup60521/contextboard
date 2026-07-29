import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createDesktopRouter, type DesktopRouter } from "./router";
import {
	DesktopRuntimeProvider,
	type DesktopRuntimeProviderProps,
} from "./runtime/DesktopRuntimeProvider";

export type DesktopAppProps = {
	invoke?: DesktopRuntimeProviderProps["invoke"];
	router?: DesktopRouter;
};

export function DesktopApp({ invoke, router }: DesktopAppProps = {}) {
	const [instance] = useState(() => router ?? createDesktopRouter());
	return (
		<DesktopRuntimeProvider invoke={invoke}>
			<RouterProvider router={instance} />
		</DesktopRuntimeProvider>
	);
}
