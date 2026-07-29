import { RuntimeNotice, SyncStatusIndicator, AppShell } from "@contextboard/ui";
import { Outlet } from "@tanstack/react-router";
import { SidebarProvider } from "@contextboard/web-ui";
import { DesktopApplicationRuntime } from "../runtime/DesktopApplicationRuntime";
import { useDesktopRuntime } from "../runtime/DesktopRuntimeProvider";
import { DesktopWebSidebar } from "./DesktopWebSidebar";

function DesktopBootScreen() {
	const runtime = useDesktopRuntime();
	if (runtime.status === "ready") return null;

	const isError = runtime.status === "error";
	const unavailable = runtime.status === "storage-unavailable";

	return (
		<main className="desktop-boot" aria-busy={runtime.status === "starting"}>
			<header className="desktop-status-rail">
				<SyncStatusIndicator
					message={
						isError
							? runtime.error.message
							: unavailable
								? runtime.reason
								: "Connecting to the desktop runtime"
					}
					state={isError ? "error" : unavailable ? "unavailable" : "offline"}
				/>
			</header>
			<RuntimeNotice
				description={
					isError
						? "Restart the app after checking the local Tauri runtime."
						: unavailable
							? "The native window is connected, but this build cannot open local storage."
							: "Contextboard is opening your local workspace."
				}
				title={
					isError
						? "The desktop runtime did not start"
						: unavailable
							? "Local storage is unavailable"
							: "Opening the desktop workspace"
				}
			/>
		</main>
	);
}

export function DesktopRootLayout() {
	const runtime = useDesktopRuntime();
	if (runtime.status !== "ready") return <DesktopBootScreen />;

	return (
		<DesktopApplicationRuntime>
			<SidebarProvider defaultOpen>
				<AppShell sidebar={<DesktopWebSidebar />}>
					<Outlet />
				</AppShell>
			</SidebarProvider>
		</DesktopApplicationRuntime>
	);
}
