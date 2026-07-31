import {
	AppSidebar,
	type SidebarFooterRuntime,
	SidebarTabsProvider,
} from "@contextboard/web-ui";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useDesktopSync } from "../runtime/DesktopSyncProvider";

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

export function DesktopSidebar() {
	const sync = useDesktopSync();
	const signedIn = sync.account !== null;
	const footer: SidebarFooterRuntime = {
		state: sync.state,
		message: sync.message,
		// Signed out, the shared footer falls back to a local-only account chip,
		// so the sign-in button is the only control worth rendering.
		account: signedIn
			? { name: sync.account?.name, email: sync.account?.email }
			: undefined,
		pendingCount: sync.pendingCount,
		signIn: signedIn ? undefined : sync.signIn,
		signOut: signedIn ? sync.signOut : undefined,
		syncNow: signedIn ? sync.syncNow : undefined,
		createWorkspace: signedIn ? sync.createWorkspace : undefined,
		workspaceSelectionRequired: sync.workspaceSelectionRequired,
	};
	return <AppSidebar footer={footer} />;
}
