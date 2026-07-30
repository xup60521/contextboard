import { AppShell as SharedAppShell } from "@contextboard/ui";
import applicationCss from "@contextboard/application/application.css?url";
import {
	SidebarProvider,
	SidebarTabsProvider,
} from "@contextboard/web-ui";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { CommandPalette } from "../components/search/CommandPalette";
import { AppSidebar } from "../components/whiteboard/AppSidebar";
import { LocalDatabaseProvider } from "../integrations/local/provider";
import { SyncProvider } from "../integrations/sync/provider";
import { WebApplicationRuntime } from "../integrations/application/WebApplicationRuntime";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "@contextboard/web-ui/styles.css?url";
import editorCss from "@contextboard/web-ui/editor.css?url";
import tldrawCss from "@contextboard/web-ui/tldraw.css?url";

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
				href: applicationCss,
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "stylesheet",
				href: editorCss,
			},
			{
				rel: "stylesheet",
				href: tldrawCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const params = useParams({ strict: false });
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Static theme bootstrap prevents a hydration flash. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased h-screen [overflow-wrap:anywhere] selection:bg-[rgba(99,102,241,0.24)]">
				<LocalDatabaseProvider>
					<SyncProvider>
						<WebApplicationRuntime>
						<SidebarProvider>
							<SidebarTabsProvider
								route={{
									pathname,
									whiteboardId:
										typeof params.whiteboardId === "string"
											? params.whiteboardId
											: undefined,
									cardId:
										typeof params.cardId === "string"
											? params.cardId
											: undefined,
								}}
							>
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
						</WebApplicationRuntime>
					</SyncProvider>
				</LocalDatabaseProvider>
				<Scripts />
			</body>
		</html>
	);
}

function AppShell({ children }: { children: React.ReactNode }) {
	return <SharedAppShell sidebar={<AppSidebar />}>{children}</SharedAppShell>;
}
