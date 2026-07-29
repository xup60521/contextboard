import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		exclude: [
			"src/CardEditorPane.test.tsx",
			"src/useImageUpload.test.ts",
			"src/useCardReferenceSupport.test.ts",
			"node_modules/**",
		],
	},
	resolve: {
		alias: {
			"#/lib/utils": new URL("./src/platform/utils.ts", import.meta.url).pathname,
			"#/integrations/local/types": new URL(
				"./src/platform/types.ts",
				import.meta.url,
			).pathname,
		},
	},
});
