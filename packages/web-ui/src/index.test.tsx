// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { AppSidebarFrame, SidebarProvider, SidebarOpenButton } from "./index.ts";

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return sourceFiles(full);
		if (/\.test\.tsx?$/.test(entry)) return [];
		return /\.tsx?$/.test(entry) ? [full] : [];
	});
}

describe("shared UI package boundary", () => {
	/**
	 * Phase 1.2 of the desktop parity plan: the shared UI may not reach into a
	 * platform. If this fails, inject the capability through the application
	 * runtime instead of importing it here.
	 */
	test("no source imports a platform-specific module", () => {
		const forbidden = [
			"dexie",
			"@contextboard/local-db",
			"@contextboard/storage-indexeddb",
			"@contextboard/storage-desktop",
			"@contextboard/auth-client",
			"@tauri-apps/api",
			"@tanstack/react-start",
		];
		const offenders = sourceFiles(join(import.meta.dirname)).flatMap((file) => {
			const text = readFileSync(file, "utf8");
			return forbidden
				.filter((pkg) => text.includes(`"${pkg}`) || text.includes(`'${pkg}`))
				.map((pkg) => `${file} imports ${pkg}`);
		});
		expect(offenders).toEqual([]);
	});
});

describe("AppSidebarFrame", () => {
	beforeEach(() => {
		cleanup();
		localStorage.clear();
		document.documentElement.className = "";
	});

	test("renders content and cycles the theme", () => {
		render(
			<SidebarProvider defaultOpen>
				<AppSidebarFrame footer={<span>footer</span>}>
					<nav>tabs</nav>
				</AppSidebarFrame>
			</SidebarProvider>,
		);

		expect(screen.getByText("tabs")).toBeDefined();
		expect(screen.getByText("footer")).toBeDefined();

		const theme = screen.getByTitle("System");
		fireEvent.click(theme);
		expect(screen.getByTitle("Light")).toBeDefined();
	});

	test("closing collapses the rail and the open button restores it", () => {
		render(
			<SidebarProvider defaultOpen>
				<SidebarOpenButton />
				<AppSidebarFrame>
					<nav>tabs</nav>
				</AppSidebarFrame>
			</SidebarProvider>,
		);

		fireEvent.click(screen.getByLabelText("Close sidebar"));
		expect(screen.getByRole("complementary", { hidden: true }).ariaHidden).toBe(
			"true",
		);

		fireEvent.click(screen.getByLabelText("Open sidebar"));
		expect(screen.getByRole("complementary").ariaHidden).toBe("false");
	});
});
