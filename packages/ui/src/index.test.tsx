// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SyncStatusIndicator } from "./index";

describe("shared application chrome", () => {
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
});
