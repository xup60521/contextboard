import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { CommandPalette } from "../components/search/CommandPalette";
import { SidebarTabsProvider } from "../components/sidebar/SidebarTabsContext";
import { AppSidebar } from "../components/whiteboard/AppSidebar";
import { SidebarProvider } from "../components/whiteboard/SidebarContext";
import ConvexProvider from "../integrations/convex/provider";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Contextboard",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Static theme bootstrap prevents a hydration flash. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased h-screen [overflow-wrap:anywhere] selection:bg-[rgba(99,102,241,0.24)]">
				<ConvexProvider>
					<SidebarProvider>
						<SidebarTabsProvider>
							<AppShell>{children}</AppShell>
						</SidebarTabsProvider>
						<CommandPalette />
						<TanStackDevtools
							config={{
								position: "bottom-right",
							}}
							plugins={[
								{
									name: "Tanstack Router",
									render: <TanStackRouterDevtoolsPanel />,
								},
								TanStackQueryDevtools,
							]}
						/>
					</SidebarProvider>
				</ConvexProvider>
				<Scripts />
			</body>
		</html>
	);
}

function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-dvh overflow-hidden bg-[var(--background)]">
			<AppSidebar />
			<div
				className="min-w-0 flex-1 overflow-y-auto"
				data-app-scroll-host="true"
			>
				{children}
			</div>
		</div>
	);
}
