import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	// Sync configuration lives in the repository-root .env files alongside the
	// server's own settings.
	envDir: path.resolve(__dirname, "../.."),
	resolve: {
		alias: {
			"#": path.resolve(__dirname, "../web/src"),
			"@": path.resolve(__dirname, "../web/src"),
		},
	},
	plugins: [tailwindcss(), react()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
});
