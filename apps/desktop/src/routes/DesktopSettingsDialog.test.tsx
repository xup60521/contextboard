// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { DesktopRuntimeProvider } from "../runtime/DesktopRuntimeProvider";
import type { Invoke } from "../runtime/repository";
import { DesktopSettingsDialog } from "./DesktopSettingsDialog";

afterEach(cleanup);

function stubInvoke(): Invoke {
	let enabled = false;
	return async (command, args = {}) => {
		if (command === "desktop_bootstrap")
			return { version: "0.0.0", platform: "windows", storageAvailable: true };
		if (command === "desktop_setting") return null;
		if (command === "desktop_bridge_status")
			return {
				enabled,
				port: enabled ? 8787 : null,
				configuredPort: 8787,
			};
		if (command === "desktop_bridge_set_enabled") {
			enabled = args.enabled === true;
			return { enabled, port: enabled ? 8787 : null, configuredPort: 8787 };
		}
		throw new Error(`unexpected command ${command}`);
	};
}

function mount(invoke: Invoke) {
	render(
		<DesktopRuntimeProvider invoke={invoke}>
			<DesktopSettingsDialog />
		</DesktopRuntimeProvider>,
	);
}

describe("desktop settings dialog", () => {
	test("opens and shows the agent access section", async () => {
		mount(stubInvoke());
		fireEvent.click(screen.getByLabelText("Settings"));
		expect(await screen.findByText("AI agent access")).toBeTruthy();
	});

	test("switches the bridge on and states the consequence", async () => {
		mount(stubInvoke());
		fireEvent.click(screen.getByLabelText("Settings"));
		const toggle = await screen.findByRole("button", { name: "Off" });
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		// Off is described as local-only, not as a broken state.
		expect(screen.getByText(/not reachable from anywhere else/i)).toBeTruthy();

		fireEvent.click(toggle);
		const enabled = await screen.findByRole("button", { name: "On" });
		expect(enabled.getAttribute("aria-pressed")).toBe("true");
		expect(
			screen.getByText(/any program running on this computer/i),
		).toBeTruthy();
	});

	// An older shell without the commands must degrade to hiding the section
	// rather than showing a broken control.
	test("hides the section when the shell does not support it", async () => {
		mount(async (command) => {
			if (command === "desktop_bootstrap")
				return {
					version: "0.0.0",
					platform: "windows",
					storageAvailable: true,
				};
			if (command === "desktop_setting") return null;
			throw new Error("unknown command");
		});
		fireEvent.click(screen.getByLabelText("Settings"));
		expect(await screen.findByText("Settings")).toBeTruthy();
		expect(screen.queryByText("AI agent access")).toBeNull();
	});
});
