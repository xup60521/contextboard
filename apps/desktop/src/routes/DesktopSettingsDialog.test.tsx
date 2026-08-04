// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { DesktopRuntimeProvider } from "../runtime/DesktopRuntimeProvider";
import { DesktopSyncProvider } from "../runtime/DesktopSyncProvider";
import type { Invoke } from "../runtime/repository";
import { DesktopSettingsDialog } from "./DesktopSettingsDialog";

afterEach(cleanup);

function stubInvoke(localWorkspaces: string[] = [], calls: string[] = []): Invoke {
	let enabled = false;
	return async (command, args = {}) => {
		if (command === "desktop_bootstrap")
			return { version: "0.0.0", platform: "windows", storageAvailable: true };
		if (command === "desktop_setting") return null;
		if (command === "workspace_list_local") return localWorkspaces;
		if (command === "workspace_delete") {
			calls.push(command);
			return null;
		}
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
			<DesktopSyncProvider invoke={invoke}>
				<DesktopSettingsDialog />
			</DesktopSyncProvider>
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

	test("shows local recovery actions and removes a copy after deletion", async () => {
		const calls: string[] = [];
		mount(stubInvoke(["stranded-local"], calls));
		fireEvent.click(screen.getByLabelText("Settings"));

		expect(await screen.findByText("stranded-local")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /^Merge and delete$/ }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /^Delete local copy$/ }));
		expect(
			await screen.findByText(/permanently delete all local entities/i),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /^Delete local workspace$/ }),
		);

		await waitFor(() => expect(calls).toEqual(["workspace_delete"]));
		await waitFor(() =>
			expect(screen.queryByText("stranded-local")).toBeNull(),
		);
	});

	test("does not offer recovery actions for the active workspace", async () => {
		mount(stubInvoke(["contextboard-desktop"]));
		fireEvent.click(screen.getByLabelText("Settings"));

		expect(await screen.findByText("No stranded local workspaces found.")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /^Delete local copy$/ }),
		).toBeNull();
	});
});
