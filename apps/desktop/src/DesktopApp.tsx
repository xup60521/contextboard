import { AppShell, RuntimeNotice, SyncStatusIndicator } from "@contextboard/ui";
import {
	DesktopRuntimeProvider,
	useDesktopRuntime,
} from "./runtime/DesktopRuntimeProvider";

function DesktopSidebar() {
	return (
		<aside className="desktop-sidebar">
			<div className="desktop-brand">
				<span className="desktop-brand__mark" aria-hidden="true">
					C
				</span>
				<div>
					<strong>Contextboard</strong>
					<span>Desktop</span>
				</div>
			</div>
			<nav aria-label="Workspace">
				<button
					className="desktop-nav-item desktop-nav-item--active"
					type="button"
				>
					<span aria-hidden="true">◇</span>
					Canvas
				</button>
			</nav>
			<p className="desktop-sidebar__foot">Local-first workspace</p>
		</aside>
	);
}

function DesktopContent() {
	const runtime = useDesktopRuntime();
	const storageUnavailable = runtime.status === "storage-unavailable";
	const isError = runtime.status === "error";
	const statusState = isError
		? "error"
		: storageUnavailable
			? "unavailable"
			: runtime.status === "starting"
				? "offline"
				: "idle";
	const statusMessage =
		runtime.status === "starting"
			? "Connecting to the desktop runtime"
			: storageUnavailable
				? runtime.reason
				: isError
					? runtime.error.message
					: "Desktop storage is ready";

	return (
		<AppShell
			sidebar={<DesktopSidebar />}
			status={
				<header className="desktop-status-rail">
					<SyncStatusIndicator state={statusState} message={statusMessage} />
				</header>
			}
		>
			<main className="desktop-canvas">
				<div className="desktop-grid" aria-hidden="true" />
				<RuntimeNotice
					title={
						isError
							? "The desktop runtime did not start"
							: storageUnavailable
								? "The shell is ready for storage"
								: runtime.status === "starting"
									? "Opening the desktop workspace"
									: "Desktop storage is ready"
					}
					description={
						isError
							? "Restart the app after checking the local Tauri runtime."
							: storageUnavailable
								? "The native window and semantic IPC boundary are connected. SQLite persistence arrives in the next desktop slice."
								: runtime.status === "starting"
									? "Contextboard is checking the native runtime before opening your local workspace."
									: "The desktop repository is connected and ready for workspace data."
					}
				/>
				{runtime.status !== "starting" && runtime.status !== "error" ? (
					<p className="desktop-build">
						{runtime.bootstrap.platform} · v{runtime.bootstrap.version}
					</p>
				) : null}
			</main>
		</AppShell>
	);
}

export function DesktopApp() {
	return (
		<DesktopRuntimeProvider>
			<DesktopContent />
		</DesktopRuntimeProvider>
	);
}
