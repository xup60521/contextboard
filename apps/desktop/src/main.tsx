import "@contextboard/application/application.css";
import "../../web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopApp } from "./DesktopApp";
import "./desktop.css";

const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element is missing");

createRoot(root).render(
	<StrictMode>
		<DesktopApp />
	</StrictMode>,
);
