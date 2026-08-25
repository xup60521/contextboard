import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

async function toggleFullscreen() {
	const appWindow = getCurrentWindow();
	await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
}

export function useFullscreenShortcut() {
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "F11" || event.repeat) return;

			event.preventDefault();
			void toggleFullscreen().catch((error) => {
				console.error("Unable to toggle fullscreen", error);
			});
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
}
