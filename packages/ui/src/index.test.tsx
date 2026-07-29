// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AppShell, RuntimeNotice, SyncStatusIndicator } from "./index";

describe("shared application chrome", () => {
	test("renders the shell slots", () => {
		render(
			<AppShell sidebar={<nav>Boards</nav>} status={<p>Local</p>}>
				<main>Canvas</main>
			</AppShell>,
		);
		expect(screen.getByText("Boards")).toBeTruthy();
		expect(screen.getByText("Local")).toBeTruthy();
		expect(screen.getByText("Canvas")).toBeTruthy();
	});

	test("does not invoke Sync now while storage is unavailable", () => {
		const syncNow = vi.fn();
		render(
			<SyncStatusIndicator
				state="unavailable"
				message="Desktop storage is not available in this build"
				onSyncNow={syncNow}
			/>,
		);
		const button = screen.getByRole("button", { name: "Sync now" });
		expect(button.hasAttribute("disabled")).toBe(true);
		fireEvent.click(button);
		expect(syncNow).not.toHaveBeenCalled();
	});

	test("labels runtime direction clearly", () => {
		render(
			<RuntimeNotice
				title="Storage is not ready"
				description="The desktop shell is connected, but local storage is not built yet."
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Storage is not ready" }),
		).toBeTruthy();
	});
});
