// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DesktopRuntimeProvider } from "./DesktopRuntimeProvider";
import { DesktopSyncProvider, useDesktopSync } from "./DesktopSyncProvider";
import type { Invoke } from "./repository";

const BASE_URL = "http://localhost:3000";

type StubOptions = {
	storedToken?: string | null;
	remoteWorkspaces?: string[];
	hasData?: boolean;
	pendingBatches?: unknown[];
	failMerge?: boolean;
};

function createStub(options: StubOptions = {}) {
	const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
	let workspaceId = "contextboard-desktop";
	let pending = options.pendingBatches ?? [];
	let failPull = false;

	const invoke: Invoke = async (command, args = {}) => {
		calls.push({ command, args });
		switch (command) {
			case "desktop_bootstrap":
				return {
					version: "0.0.0",
					platform: "windows",
					storageAvailable: true,
				};
			case "desktop_setting":
				return workspaceId;
			case "desktop_set_setting":
				workspaceId = String(args.value);
				return null;
			case "desktop_auth_token":
				return options.storedToken ?? null;
			case "desktop_auth_clear":
			case "desktop_auth_cancel":
				return null;
			case "workspace_pending_batches":
				return pending;
			case "workspace_acknowledge":
				// Batches leave the queue only once the server has them, exactly as
				// SQLite does.
				pending = [];
				return null;
			case "workspace_apply_remote":
				return { applied: 0, conflicts: 0 };
			case "workspace_update_sync_cursor":
				return null;
			case "workspace_sync_state":
				return {
					peerId: "contextboard-cloud",
					cursor: null,
					enabled: true,
					updatedAt: 1,
					lastSyncedAt: null,
				};
			case "workspace_missing_blobs":
				return [];
			case "workspace_has_data":
				return options.hasData ?? false;
			case "workspace_device_id":
				return "device-1";
			case "workspace_adopt":
				return null;
			case "workspace_merge":
				if (options.failMerge) throw new Error("merge failed");
				return null;
			case "workspace_delete":
				return null;
			default:
				throw { code: "INVALID_ARGUMENT", message: `Unknown ${command}` };
		}
	};

	const requests: Array<{
		url: string;
		headers: Headers;
		credentials?: RequestCredentials;
	}> = [];
	const fetchStub = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			requests.push({ url, headers, credentials: init?.credentials });
			const json = (body: unknown) =>
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			if (url.endsWith("/api/auth/get-session"))
				return json({
					user: { id: "user-1", name: "Ada", email: "ada@example.com" },
				});
			if (url.endsWith("/api/sync/v1/workspaces"))
				return json({
					workspaces: (
						options.remoteWorkspaces ?? ["contextboard-desktop"]
					).map((id, index) => ({
						workspaceId: id,
						role: "owner",
						isDefault: index === 0,
					})),
					redirects: [],
				});
			if (url.endsWith("/api/sync/v1/workspaces/claim"))
				return json({ workspaceId: "contextboard-desktop", claimed: true });
			if (url.endsWith("/api/sync/v1/workspaces/select"))
				return json({
					workspaceId: "workspace-from-web",
					role: "owner",
					createdAt: 1,
					isDefault: true,
				});
			if (url.endsWith("/api/sync/v1/push"))
				return json({
					acknowledgedChangeIds: ["change-1"],
					missingBlobHashes: [],
				});
			if (url.endsWith("/api/sync/v1/pull"))
				if (failPull)
					return new Response(JSON.stringify({ error: "pull failed" }), {
						status: 500,
						headers: { "content-type": "application/json" },
					});
			if (url.endsWith("/api/sync/v1/pull"))
				return json({ batches: [], cursor: "7", hasMore: false });
			throw new Error(`Unexpected request ${url}`);
		},
	);

	return {
		invoke,
		calls,
		requests,
		fetchStub,
		setFailPull: (value: boolean) => {
			failPull = value;
		},
	};
}

function SyncProbe() {
	const sync = useDesktopSync();
	return (
		<div>
			<span data-testid="state">{sync.state}</span>
			<span data-testid="account">{sync.account?.email ?? "none"}</span>
			<button
				type="button"
				data-testid="switch-workspace"
				onClick={() => void sync.switchWorkspace("workspace-from-web")}
			>
				Switch workspace
			</button>
			<button
				type="button"
				data-testid="merge-workspace"
				onClick={() =>
					void sync.mergeIntoActiveWorkspace("stranded-local").catch(() => undefined)
				}
			>
				Merge workspace
			</button>
			<button
				type="button"
				data-testid="delete-workspace"
				onClick={() =>
					void sync.deleteLocalWorkspace("stranded-local").catch(() => undefined)
				}
			>
				Delete workspace
			</button>
		</div>
	);
}

function mount(invoke: Invoke) {
	return render(
		<DesktopRuntimeProvider invoke={invoke}>
			<DesktopSyncProvider invoke={invoke}>
				<SyncProbe />
			</DesktopSyncProvider>
		</DesktopRuntimeProvider>,
	);
}

beforeEach(() => {
	vi.stubEnv("VITE_CONTEXTBOARD_SYNC_URL", BASE_URL);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("Desktop sync driver", () => {
	test("stays local-only without a stored session and never calls the server", async () => {
		const stub = createStub({ storedToken: null });
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("local-only"),
		);
		expect(screen.getByTestId("account").textContent).toBe("none");
		expect(stub.fetchStub).not.toHaveBeenCalled();
	});

	test("pushes pending work with a bearer token and settles idle", async () => {
		const stub = createStub({
			storedToken: "session-token",
			pendingBatches: [
				{
					protocolVersion: 1,
					schemaVersion: 2,
					changeId: "change-1",
					workspaceId: "contextboard-desktop",
					deviceId: "device-1",
					deviceSequence: 1,
					clock: "0000000000001:000000:device-1",
					command: "cards.put",
					createdAt: 1,
					changes: [],
				},
			],
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("idle"),
		);
		expect(screen.getByTestId("account").textContent).toBe("ada@example.com");

		const push = stub.requests.find((request) => request.url.endsWith("/push"));
		expect(push?.headers.get("authorization")).toBe("Bearer session-token");
		// Cookies must not ride along: the server withholds
		// Access-Control-Allow-Credentials, so a credentialed cross-origin request
		// has its response blocked by the webview and fails opaquely.
		expect(push?.credentials).toBe("omit");
		expect(
			stub.calls.some((call) => call.command === "workspace_acknowledge"),
		).toBe(true);
	});

	test("switches the active workspace without adopting or renaming local data", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["contextboard-desktop", "workspace-from-web"],
			hasData: true,
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(
				stub.calls.some(
					(call) =>
						call.command === "workspace_sync_state" &&
						call.args?.workspaceId === "contextboard-desktop",
				),
			).toBe(true),
		);
		await act(async () => {
			fireEvent.click(screen.getByTestId("switch-workspace"));
		});

		await waitFor(() =>
			expect(
				stub.calls.some(
					(call) =>
						call.command === "workspace_sync_state" &&
						call.args?.workspaceId === "workspace-from-web",
				),
			).toBe(true),
		);
		expect(
			stub.calls.some(
				(call) =>
					call.command === "desktop_set_setting" &&
					call.args?.value === "workspace-from-web",
			),
		).toBe(true);
		expect(stub.calls.some((call) => call.command === "workspace_adopt")).toBe(
			false,
		);
		expect(
			stub.requests.some((request) =>
				request.url.endsWith("/api/sync/v1/workspaces/select"),
			),
		).toBe(true);
	});

	test("merges, syncs, and then deletes the local source", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["contextboard-desktop"],
			hasData: true,
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("idle"),
		);
		await act(async () => {
			fireEvent.click(screen.getByTestId("merge-workspace"));
		});

		await waitFor(() =>
			expect(
				stub.calls.some((call) => call.command === "workspace_delete"),
			).toBe(true),
		);
		const mergeIndex = stub.calls.findIndex(
			(call) => call.command === "workspace_merge",
		);
		const deleteIndex = stub.calls.findIndex(
			(call) => call.command === "workspace_delete",
		);
		expect(mergeIndex).toBeGreaterThanOrEqual(0);
		expect(deleteIndex).toBeGreaterThan(mergeIndex);
	});

	test("keeps the source when merge fails before sync", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["contextboard-desktop"],
			hasData: true,
			failMerge: true,
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("idle"),
		);
		await act(async () => {
			fireEvent.click(screen.getByTestId("merge-workspace"));
		});
		await waitFor(() =>
			expect(
				stub.calls.some((call) => call.command === "workspace_merge"),
			).toBe(true),
		);
		expect(stub.calls.some((call) => call.command === "workspace_delete")).toBe(
			false,
		);
	});

	test("keeps the source when sync fails after merge", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["contextboard-desktop"],
			hasData: true,
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("idle"),
		);
		stub.setFailPull(true);
		await act(async () => {
			fireEvent.click(screen.getByTestId("merge-workspace"));
		});
		await waitFor(() =>
			expect(
				stub.calls.filter((call) => call.command === "workspace_merge"),
			).toHaveLength(1),
		);
		expect(stub.calls.some((call) => call.command === "workspace_delete")).toBe(
			false,
		);
	});

	test("deletes a local workspace without contacting the server", async () => {
		const stub = createStub({ storedToken: null });
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("local-only"),
		);
		await act(async () => {
			fireEvent.click(screen.getByTestId("delete-workspace"));
		});
		await waitFor(() =>
			expect(
				stub.calls.some((call) => call.command === "workspace_delete"),
			).toBe(true),
		);
		expect(stub.fetchStub).not.toHaveBeenCalled();
	});

	test("adopts the account workspace when this device holds no data", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["workspace-from-web"],
			hasData: false,
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(
				stub.calls.some((call) => call.command === "workspace_adopt"),
			).toBe(true),
		);
		const adopt = stub.calls.find((call) => call.command === "workspace_adopt");
		expect(adopt?.args?.targetWorkspaceId).toBe("workspace-from-web");
		// The choice must survive a restart, so it is persisted, not just held in
		// memory.
		await waitFor(() =>
			expect(
				stub.calls.some(
					(call) =>
						call.command === "desktop_set_setting" &&
						call.args?.value === "workspace-from-web",
				),
			).toBe(true),
		);
	});

	test("does not claim a new account workspace when the device already holds data", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["workspace-from-web"],
			hasData: true,
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("error"),
		);
		expect(
			stub.requests.some((request) => request.url.endsWith("/claim")),
		).toBe(false);
		expect(stub.calls.some((call) => call.command === "workspace_adopt")).toBe(
			false,
		);
	});

	test("follows a server workspace redirect even when local data exists", async () => {
		const stub = createStub({
			storedToken: "session-token",
			remoteWorkspaces: ["workspace-from-web"],
			hasData: true,
		});
		stub.fetchStub.mockImplementation(
			async (input: RequestInfo | URL, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				stub.requests.push({ url, headers, credentials: init?.credentials });
				const json = (body: unknown) =>
					new Response(JSON.stringify(body), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				if (url.endsWith("/api/auth/get-session"))
					return json({ user: { id: "user-1", email: "ada@example.com" } });
				if (url.endsWith("/api/sync/v1/workspaces"))
					return json({
						workspaces: [
							{
								workspaceId: "workspace-from-web",
								role: "owner",
								isDefault: true,
							},
						],
						redirects: [
							{
								fromWorkspaceId: "contextboard-desktop",
								toWorkspaceId: "workspace-from-web",
								mergedAt: 1,
							},
						],
					});
				throw new Error(`Unexpected request ${url}`);
			},
		);
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(
				stub.calls.some(
					(call) =>
						call.command === "workspace_adopt" &&
						call.args?.targetWorkspaceId === "workspace-from-web",
				),
			).toBe(true),
		);
	});

	test("drops back to local-only and clears the keyring on a rejected session", async () => {
		const stub = createStub({ storedToken: "expired-token" });
		stub.fetchStub.mockImplementation(async (input: RequestInfo | URL) => {
			if (String(input).endsWith("/api/auth/get-session"))
				return new Response(null, { status: 401 });
			throw new Error("Unexpected request");
		});
		vi.stubGlobal("fetch", stub.fetchStub);
		mount(stub.invoke);

		await waitFor(() =>
			expect(
				stub.calls.some((call) => call.command === "desktop_auth_clear"),
			).toBe(true),
		);
		expect(screen.getByTestId("state").textContent).toBe("local-only");
	});
});
