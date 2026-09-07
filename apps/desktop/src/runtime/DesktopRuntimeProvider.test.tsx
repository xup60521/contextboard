// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	DesktopRuntimeProvider,
	useDesktopRuntime,
} from "./DesktopRuntimeProvider";

const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

function StateProbe() {
	const state = useDesktopRuntime();
	return <p>{state.status}</p>;
}

function WorkspaceProbe() {
	const state = useDesktopRuntime();
	if (state.status !== "ready") return <p>{state.status}</p>;
	return (
		<>
			<p>Workspace: {state.workspaceId}</p>
			<button type="button" onClick={() => void state.adoptWorkspaceId("remote")}>
				Adopt workspace
			</button>
			<button
				type="button"
				onClick={() =>
					void state.repository.query({ type: "cards.list", input: {} })
				}
			>
				Read cards
			</button>
			<button type="button" onClick={() => void state.setWorkspaceId("remote")}>
				Switch workspace
			</button>
			<button
				type="button"
				onClick={() => void state.deleteWorkspace("stranded")}
			>
				Delete workspace
			</button>
		</>
	);
}

afterEach(() => {
	cleanup();
	listenMock.mockReset();
});

describe("DesktopRuntimeProvider", () => {
	test("becomes ready before a late listener resolves and cleans it up", async () => {
		let resolveListen!: (stop: () => void) => void;
		const listenPromise = new Promise<() => void>((resolve) => {
			resolveListen = resolve;
		});
		listenMock.mockReturnValueOnce(listenPromise);
		const stop = vi.fn();
		const invoke = vi.fn(async (command: string) => {
			if (command === "desktop_bootstrap")
				return {
					version: "0.0.0",
					platform: "windows",
					storageAvailable: true,
				};
			if (command === "desktop_setting") return null;
			return null;
		});
		const { unmount } = render(
			<DesktopRuntimeProvider invoke={invoke}>
				<StateProbe />
			</DesktopRuntimeProvider>,
		);

		expect(await screen.findByText("ready")).toBeTruthy();
		await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
		unmount();
		resolveListen(stop);
		await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
	});

	test("reports malformed bootstrap failures", async () => {
		const invoke = vi.fn(async () => ({ unexpected: true }));
		render(
			<DesktopRuntimeProvider invoke={invoke}>
				<StateProbe />
			</DesktopRuntimeProvider>,
		);
		expect(await screen.findByText("error")).toBeTruthy();
	});

	test.each(["Switch workspace", "Adopt workspace"])("%s persists the selection and scopes subsequent reads", async (action) => {
		const invoke = vi.fn(
			async (command: string) => {
				if (command === "desktop_bootstrap")
					return {
						version: "0.0.0",
						platform: "windows",
						storageAvailable: true,
					};
				if (command === "desktop_setting") return "local";
				return null;
			},
		);
		render(
			<DesktopRuntimeProvider invoke={invoke}>
				<WorkspaceProbe />
			</DesktopRuntimeProvider>,
		);
		await screen.findByText("Workspace: local");
		fireEvent.click(screen.getByRole("button", { name: action }));
		await screen.findByText("Workspace: remote");
		expect(invoke).toHaveBeenCalledWith("desktop_set_setting", { key: "workspaceId", value: "remote" });
		expect(invoke.mock.calls.filter(([command]) => command === "workspace_adopt")).toHaveLength(action === "Adopt workspace" ? 1 : 0);
		fireEvent.click(screen.getByRole("button", { name: "Read cards" }));
		expect(invoke).toHaveBeenCalledWith("workspace_query", { workspaceId: "remote", query: { type: "cards.list" } });
		invoke.mockClear();
		fireEvent.click(screen.getByRole("button", { name: action }));
		expect(invoke).not.toHaveBeenCalled();
	});

	test("cleans up a listener that resolves after a workspace switch", async () => {
		const resolvers: Array<(stop: () => void) => void> = [];
		listenMock.mockImplementation(
			(_event: string, _listener: () => void) =>
				new Promise<() => void>((resolve) => resolvers.push(resolve)),
		);
		const invoke = vi.fn(async (command: string) => {
			if (command === "desktop_bootstrap")
				return {
					version: "0.0.0",
					platform: "windows",
					storageAvailable: true,
				};
			if (command === "desktop_setting") return "local";
			return null;
		});
		render(
			<DesktopRuntimeProvider invoke={invoke}>
				<WorkspaceProbe />
			</DesktopRuntimeProvider>,
		);
		await screen.findByRole("button", { name: "Switch workspace" });
		await waitFor(() => expect(resolvers).toHaveLength(1));
		fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
		await waitFor(() => expect(resolvers).toHaveLength(2));
		const oldStop = vi.fn();
		resolvers[0]!(oldStop);
		await waitFor(() => expect(oldStop).toHaveBeenCalledTimes(1));
		resolvers[1]!(vi.fn());
	});

	test("deletes a non-active workspace through the native command", async () => {
		const invoke = vi.fn(
			async (command: string) => {
				if (command === "desktop_bootstrap")
					return {
						version: "0.0.0",
						platform: "windows",
						storageAvailable: true,
					};
				if (command === "desktop_setting") return "local";
				return null;
			},
		);
		render(
			<DesktopRuntimeProvider invoke={invoke}>
				<WorkspaceProbe />
			</DesktopRuntimeProvider>,
		);
		await screen.findByRole("button", { name: "Delete workspace" });
		fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));

		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith("workspace_delete", { workspaceId: "stranded" }),
		);
		expect(invoke.mock.calls.some(([command]) => command === "desktop_set_setting")).toBe(false);
	});
});
