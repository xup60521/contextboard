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

function WorkspaceProbe({
	onRepository,
}: {
	onRepository: (repository: unknown) => void;
}) {
	const state = useDesktopRuntime();
	if (state.status !== "ready") return <p>{state.status}</p>;
	onRepository(state.repository);
	return (
		<>
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
	test("reports ready when native SQLite storage is available", async () => {
		const invoke = vi.fn(async () => ({
			version: "0.0.0",
			platform: "windows",
			storageAvailable: true,
		}));
		render(
			<DesktopRuntimeProvider invoke={invoke}>
				<StateProbe />
			</DesktopRuntimeProvider>,
		);
		expect(await screen.findByText("ready")).toBeTruthy();
	});

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

	test("switches workspace by rebuilding the repository without adopting it", async () => {
		const calls: Array<{ command: string; args?: Record<string, unknown> }> =
			[];
		const repositories: unknown[] = [];
		const invoke = vi.fn(
			async (command: string, args?: Record<string, unknown>) => {
				calls.push({ command, args });
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
				<WorkspaceProbe
					onRepository={(repository) => repositories.push(repository)}
				/>
			</DesktopRuntimeProvider>,
		);
		await screen.findByRole("button", { name: "Switch workspace" });
		fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

		await waitFor(() =>
			expect(
				calls.some(
					(call) =>
						call.command === "desktop_set_setting" &&
						call.args?.value === "remote",
				),
			).toBe(true),
		);
		expect(calls.some((call) => call.command === "workspace_adopt")).toBe(
			false,
		);
		expect(repositories.length).toBeGreaterThanOrEqual(2);
		expect(repositories[0]).not.toBe(repositories.at(-1));
	});

	test("cleans up a listener that resolves after a workspace switch", async () => {
		const resolvers: Array<(stop: () => void) => void> = [];
		listenMock.mockImplementation(
			(_event: string, _listener: () => void) =>
				new Promise<() => void>((resolve) => resolvers.push(resolve)),
		);
		const calls: string[] = [];
		const invoke = vi.fn(async (command: string) => {
			calls.push(command);
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
				<WorkspaceProbe onRepository={() => undefined} />
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
		const calls: Array<{ command: string; args?: Record<string, unknown> }> =
			[];
		const invoke = vi.fn(
			async (command: string, args?: Record<string, unknown>) => {
				calls.push({ command, args });
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
				<WorkspaceProbe onRepository={() => undefined} />
			</DesktopRuntimeProvider>,
		);
		await screen.findByRole("button", { name: "Delete workspace" });
		fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));

		await waitFor(() =>
			expect(
				calls.some(
					(call) =>
						call.command === "workspace_delete" &&
						call.args?.workspaceId === "stranded",
				),
			).toBe(true),
		);
		expect(calls.some((call) => call.command === "desktop_set_setting")).toBe(
			false,
		);
	});
});
