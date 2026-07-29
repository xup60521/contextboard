// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
	DesktopRuntimeProvider,
	useDesktopRuntime,
} from "./DesktopRuntimeProvider";

function StateProbe() {
	const state = useDesktopRuntime();
	return <p>{state.status}</p>;
}

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

	test("reports malformed bootstrap failures", async () => {
		const invoke = vi.fn(async () => ({ unexpected: true }));
		render(
			<DesktopRuntimeProvider invoke={invoke}>
				<StateProbe />
			</DesktopRuntimeProvider>,
		);
		expect(await screen.findByText("error")).toBeTruthy();
	});
});
