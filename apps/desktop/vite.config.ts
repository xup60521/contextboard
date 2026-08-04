import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	resolve: {
		alias: {
			"#": path.resolve(__dirname, "../web/src"),
			"@": path.resolve(__dirname, "../web/src"),
		},
	},
	plugins: [tailwindcss(), react()],
	// @tldraw/assets exposes many `?url` imports. Rolldown's dependency
	// optimizer currently parses those as Windows filenames; leave this
	// package in Vite's normal asset pipeline instead.
	optimizeDeps: {
		exclude: ["@tldraw/assets"],
	},
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
