// @vitest-environment jsdom

import {
	useApplicationRuntime,
	useApplicationSyncStatus,
} from "@contextboard/application";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DesktopSyncRuntime } from "./DesktopSyncProvider";

const syncState: { current: DesktopSyncRuntime } = {
	current: {
		state: "idle",
		message: undefined,
		pendingCount: 0,
		account: null,
		signIn: async () => undefined,
		signOut: async () => undefined,
		syncNow: async () => undefined,
		createWorkspace: async () => undefined,
		workspaces: [],
		switchWorkspace: async () => undefined,
		mergeIntoActiveWorkspace: async () => undefined,
		deleteLocalWorkspace: async () => undefined,
		workspaceSelectionRequired: false,
	},
};

vi.mock("./DesktopSyncProvider", () => ({
	useDesktopSync: () => syncState.current,
}));

// The real `useRouter` returns a stable instance; the stub must too, or the
// composition root sees a changed dependency on every render.
const router = {
	history: { push: () => undefined, replace: () => undefined },
};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouter: () => router,
}));

const { DesktopApplicationRuntime } = await import(
	"./DesktopApplicationRuntime"
);
const { DesktopRuntimeProvider } = await import("./DesktopRuntimeProvider");

const invoke = async (command: string) => {
	if (command === "desktop_bootstrap")
		return { version: "0.0.0", platform: "windows", storageAvailable: true };
	return null;
};

const renders: Array<{ capabilities: unknown[]; syncState: string }> = [];

function Probe() {
	const runtime = useApplicationRuntime();
	const sync = useApplicationSyncStatus();
	renders.push({
		capabilities: [
			runtime.cards,
			runtime.whiteboards,
			runtime.canvas,
			runtime.files,
			runtime.navigation,
		],
		syncState: sync.state,
	});
	return <span data-testid="sync-state">{sync.state}</span>;
}

// A fresh element per render: React bails out of re-rendering a referentially
// identical one, which would make this test unable to fail.
const tree = () => (
	<DesktopRuntimeProvider invoke={invoke}>
		<DesktopApplicationRuntime>
			<Probe />
		</DesktopApplicationRuntime>
	</DesktopRuntimeProvider>
);

afterEach(() => {
	cleanup();
	renders.length = 0;
});

describe("Desktop application runtime", () => {
	test("keeps capability identity stable while the sync status changes", async () => {
		const view = render(tree());
		await waitFor(() => expect(renders.length).toBeGreaterThan(0));
		const initial = renders.at(-1)?.capabilities ?? [];
		expect(initial).toHaveLength(5);

		// Shared views key their reads on these identities, so churn here
		// refetches every page a few times a second while sync polls.
		for (const state of ["syncing", "error", "idle"] as const) {
			syncState.current = {
				...syncState.current,
				state,
				message: state === "error" ? "boom" : undefined,
			};
			await act(async () => {
				view.rerender(tree());
			});
		}

		const latest = renders.at(-1);
		expect(latest?.syncState).toBe("idle");
		for (const [index, capability] of initial.entries())
			expect(latest?.capabilities[index]).toBe(capability);
	});
});
