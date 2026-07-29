import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { LocalDatabaseContext } from "./provider";
import { useQuery } from "./react";

const { useLiveQueryMock } = vi.hoisted(() => ({
	useLiveQueryMock: vi.fn(),
}));

vi.mock("dexie-react-hooks", () => ({
	useLiveQuery: useLiveQueryMock,
}));

function wrapper({ children }: { children: ReactNode }) {
	return (
		<LocalDatabaseContext.Provider
			value={
				{
					status: "ready",
					database: {},
					workspaceId: "workspace",
					deviceId: "device",
					error: null,
					updateWorkspaceIdentity: vi.fn(),
				} as never
			}
		>
			{children}
		</LocalDatabaseContext.Provider>
	);
}

describe("useQuery identity", () => {
	test("does not expose a retained result from previous arguments", () => {
		const argsA = { whiteboardId: "A" };
		const argsB = { whiteboardId: "B" };
		useLiveQueryMock.mockReturnValue({
			key: JSON.stringify(["tldrawDocuments.get", argsA]),
			value: "drawing A",
		});

		const { result, rerender } = renderHook(
			({ args }) => useQuery("tldrawDocuments.get", args),
			{ initialProps: { args: argsA }, wrapper },
		);
		expect(result.current).toBe("drawing A");

		rerender({ args: argsB });
		expect(result.current).toBeUndefined();

		useLiveQueryMock.mockReturnValue({
			key: JSON.stringify(["tldrawDocuments.get", argsB]),
			value: "drawing B",
		});
		rerender({ args: argsB });
		expect(result.current).toBe("drawing B");
	});

	test("skip does not leak the previous query result", () => {
		useLiveQueryMock.mockReturnValue({
			key: JSON.stringify([
				"tldrawDocuments.get",
				{ whiteboardId: "A" },
			]),
			value: "drawing A",
		});

		const { result } = renderHook(
			() => useQuery("tldrawDocuments.get", "skip"),
			{ wrapper },
		);

		expect(result.current).toBeUndefined();
	});
});
