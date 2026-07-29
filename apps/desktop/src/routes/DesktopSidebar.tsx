import {
	AppSidebar,
	type SidebarFooterRuntime,
	SidebarTabsProvider,
} from "@contextboard/web-ui";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

function useDesktopRouteState() {
	return useRouterState({
		select: (state) => {
			const pathname = state.location.pathname;
			const params = state.matches.at(-1)?.params as
				| { cardId?: string; whiteboardId?: string }
				| undefined;
			return {
				pathname,
				cardId: params?.cardId,
				whiteboardId: params?.whiteboardId,
			};
		},
	});
}

export function DesktopSidebarTabsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const route = useDesktopRouteState();
	return <SidebarTabsProvider route={route}>{children}</SidebarTabsProvider>;
}

/**
 * Desktop has no Web OAuth session, so the footer reports the local-only sync
 * state and omits the sign-in controls rather than rendering dead buttons.
 */
const desktopFooter: SidebarFooterRuntime = {
	state: "local-only",
	message: "Local only",
};

export function DesktopSidebar() {
	return <AppSidebar footer={desktopFooter} />;
}
