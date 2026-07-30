import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const desktopCss = readFileSync(
	new URL("./desktop.css", import.meta.url),
	"utf8",
);
const desktopHtml = readFileSync(
	new URL("../index.html", import.meta.url),
	"utf8",
);
const tauriConfig = JSON.parse(
	readFileSync(
		new URL("../src-tauri/tauri.conf.json", import.meta.url),
		"utf8",
	),
) as {
	app: {
		security: {
			csp: string;
		};
	};
};

const sharedTokens = [
	"background",
	"foreground",
	"card",
	"surface",
	"surface-strong",
	"line",
	"sea-ink",
	"sea-ink-soft",
	"lagoon",
	"muted",
] as const;

describe("desktop stylesheet contract", () => {
	test("does not override shared application design tokens", () => {
		for (const token of sharedTokens) {
			expect(desktopCss).not.toMatch(
				new RegExp(`--${token.replaceAll("-", "\\-")}\\s*:`),
			);
		}
	});

	test("keeps desktop-only colors and typography scoped to the boot screen", () => {
		const bootRule = desktopCss.match(/\.desktop-boot\s*\{(?<body>[\s\S]*?)\}/)
			?.groups?.body;

		expect(bootRule).toContain("--desktop-boot-ink:");
		expect(bootRule).toContain("--desktop-boot-muted:");
		expect(bootRule).toContain("font-family:");
		expect(desktopCss).not.toMatch(/:root\s*\{/);
		expect(desktopCss).not.toMatch(/(?:^|\})\s*button\s*\{/);
	});

	test("allows the shared web font stylesheet in the native webview", () => {
		const { csp } = tauriConfig.app.security;

		expect(csp).toContain(
			"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		);
		expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
	});

	test("uses the same body-level rendering classes as the web shell", () => {
		expect(desktopHtml).toContain(
			'<body class="font-sans antialiased h-screen [overflow-wrap:anywhere] selection:bg-[rgba(99,102,241,0.24)]">',
		);
	});
});
