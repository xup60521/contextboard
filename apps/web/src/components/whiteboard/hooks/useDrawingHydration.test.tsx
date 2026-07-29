import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TLStoreSnapshot } from "tldraw";
import type { Id } from "#/integrations/local/types";
import type { TldrawDocumentResult } from "../whiteboard-canvas-helpers";
import { useDrawingHydration } from "./useDrawingHydration";

const currentSnapshot = {
	schema: {
		schemaVersion: 2,
		sequences: { "com.tldraw.shape": 7 },
	},
	store: {},
} as TLStoreSnapshot;

function drawing(
	whiteboardId: string,
	schema: TLStoreSnapshot["schema"] | null = null,
): Exclude<TldrawDocumentResult, null> {
	return {
		whiteboardId: whiteboardId as Id<"whiteboards">,
		snapshot: { schema, store: {} },
		revision: 1,
		canvasRecordVersions: {},
	};
}

function createEditor(loadSnapshot = vi.fn()) {
	return {
		loadSnapshot,
		getCurrentPageShapes: vi.fn(() => []),
		run: vi.fn((callback: () => void) => callback()),
		store: {
			getStoreSnapshot: vi.fn(() => currentSnapshot),
			remove: vi.fn(),
			put: vi.fn(),
		},
	};
}

const drawingSaveState = {
	pending: false,
	saving: false,
	awaitingEcho: false,
	generation: 0,
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useDrawingHydration", () => {
	test("rejects a snapshot belonging to the previous whiteboard", async () => {
		const editor = createEditor();
		const acknowledgeDrawingEcho = vi.fn(() => true);
		const hydratingRef = { current: false };
		const { result, rerender } = renderHook(
			({
				activeEditor,
				document,
			}: {
				activeEditor: ReturnType<typeof createEditor> | null;
				document: TldrawDocumentResult | undefined;
			}) =>
				useDrawingHydration({
					editor: activeEditor as never,
					whiteboardId: "B" as Id<"whiteboards">,
					whiteboardKey: "B",
					tldrawDocument: document,
					itemsReady: true,
					hydratingRef,
					drawingSaveState,
					acknowledgeDrawingEcho,
				}),
			{
				initialProps: {
					activeEditor: null,
					document: drawing("A"),
				},
			},
		);
		result.current.emptyDrawingSnapshotRef.current = currentSnapshot;

		rerender({ activeEditor: editor, document: drawing("A") });
		await waitFor(() =>
			expect(result.current.hydrationError?.stage).toBe("identity"),
		);
		expect(editor.loadSnapshot).not.toHaveBeenCalled();

		rerender({ activeEditor: editor, document: drawing("B") });
		await waitFor(() => expect(editor.loadSnapshot).toHaveBeenCalledTimes(1));
		expect(result.current.loadedDrawingKey).toBe("B");
	});

	test("contains migration failures and can retry without remounting", async () => {
		const migrationError = new Error(
			"Failed to migrate store snapshot: migration-error",
		);
		const loadSnapshot = vi
			.fn()
			.mockImplementationOnce(() => {
				throw migrationError;
			})
			.mockImplementationOnce(() => undefined);
		const editor = createEditor(loadSnapshot);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const hydratingRef = { current: false };
		const document = drawing("B");
		const acknowledgeDrawingEcho = vi.fn(() => true);
		const { result, rerender } = renderHook(
			({ activeEditor }: { activeEditor: ReturnType<typeof createEditor> | null }) =>
				useDrawingHydration({
					editor: activeEditor as never,
					whiteboardId: "B" as Id<"whiteboards">,
					whiteboardKey: "B",
					tldrawDocument: document,
					itemsReady: true,
					hydratingRef,
					drawingSaveState,
					acknowledgeDrawingEcho,
				}),
			{ initialProps: { activeEditor: null } },
		);
		result.current.emptyDrawingSnapshotRef.current = currentSnapshot;

		rerender({ activeEditor: editor });
		await waitFor(() =>
			expect(result.current.hydrationError?.stage).toBe("migrate"),
		);
		expect(result.current.loadedDrawingKey).toBeNull();
		expect(hydratingRef.current).toBe(false);

		act(() => result.current.retryDrawingHydration());
		await waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(2));
		expect(result.current.hydrationError).toBeNull();
		expect(result.current.loadedDrawingKey).toBe("B");
		expect(consoleError).toHaveBeenCalled();
	});
});
