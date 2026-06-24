import path from "node:path";
import { defineConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [viteReact()],
	resolve: {
		alias: {
			"#": path.resolve(__dirname, "src"),
			"@": path.resolve(__dirname, "src"),
		},
	},
	test: {
		environment: "jsdom",
	},
});
