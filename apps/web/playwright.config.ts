import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: "http://127.0.0.1:3000",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		...devices["Desktop Chrome"],
		...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
			? {
					launchOptions: {
						executablePath:
							process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
					},
				}
			: {}),
	},
	webServer: {
		command: "bun run dev",
		url: "http://127.0.0.1:3000",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
