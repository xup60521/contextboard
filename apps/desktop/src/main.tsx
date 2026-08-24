import "@contextboard/application/application.css";
import "@contextboard/web-ui/styles.css";
import "@contextboard/web-ui/editor.css";
import "@contextboard/web-ui/tldraw.css";
import { setExternalLinkOpener } from "@contextboard/web-ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopApp } from "./DesktopApp";
import { openExternalUrl } from "./runtime/repository";
import "./desktop.css";

// A webview has nowhere to put a new tab, so links leave for the OS browser.
setExternalLinkOpener((href) => {
	void openExternalUrl(href).catch((error) => {
		console.error("Unable to open link", error);
	});
});

const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element is missing");

createRoot(root).render(
	<StrictMode>
		<DesktopApp />
	</StrictMode>,
);
