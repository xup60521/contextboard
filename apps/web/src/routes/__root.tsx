import applicationCss from "@contextboard/application/application.css?url";
import { AppShell as SharedAppShell } from "@contextboard/ui";
import {
	CommandPalette,
	SidebarProvider,
	SidebarTabsProvider,
} from "@contextboard/web-ui";
import editorCss from "@contextboard/web-ui/editor.css?url";
import appCss from "@contextboard/web-ui/styles.css?url";
import tldrawCss from "@contextboard/web-ui/tldraw.css?url";
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
import { AppSidebar } from "../components/whiteboard/AppSidebar";
import { WebApplicationRuntime } from "../integrations/application/WebApplicationRuntime";
import { LocalDatabaseProvider } from "../integrations/local/provider";
import { SyncProvider } from "../integrations/sync/provider";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;var accent=window.localStorage.getItem('theme-accent')||window.localStorage.getItem('theme-accent-light')||'indigo';root.setAttribute('data-accent-light',accent);root.setAttribute('data-accent-dark',accent);if(accent==='custom'){var c=window.localStorage.getItem('theme-accent-custom')||'#6366f1';root.style.setProperty('--brand-fill-light',c);root.style.setProperty('--brand-text-light',c);root.style.setProperty('--brand-fill-dark',c);root.style.setProperty('--brand-text-dark',c);}}catch(e){}})();`;

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
				rel: "icon",
				href: "/contextboard_logo.png",
				type: "image/png",
			},
			{
				rel: "apple-touch-icon",
				href: "/contextboard_logo.png",
			},
			{
				rel: "manifest",
				href: "/manifest.json",
			},
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

const BARE_PATHNAMES = new Set(["/desktop-auth"]);

function RootDocument({ children }: { children: React.ReactNode }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const params = useParams({ strict: false });
	const currentWhiteboardId =
		typeof params.whiteboardId === "string" ? params.whiteboardId : null;
	const isBarePage = BARE_PATHNAMES.has(pathname);
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Static theme bootstrap prevents a hydration flash. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased h-screen [overflow-wrap:anywhere]">
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
									<AppShell bare={isBarePage}>{children}</AppShell>
								</SidebarTabsProvider>
								{isBarePage ? null : (
									<CommandPalette currentWhiteboardId={currentWhiteboardId} />
								)}
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

function AppShell({
	children,
	bare,
}: {
	children: React.ReactNode;
	bare: boolean;
}) {
	if (bare) return <>{children}</>;
	return <SharedAppShell sidebar={<AppSidebar />}>{children}</SharedAppShell>;
}
