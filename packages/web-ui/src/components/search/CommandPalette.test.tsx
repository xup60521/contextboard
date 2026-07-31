// @vitest-environment jsdom

import {
	ApplicationRuntimeProvider,
	type ApplicationRuntime,
	type SearchResults,
} from "@contextboard/application";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const navigateMock = vi.fn();
const searchMock = vi.fn();

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

vi.mock("@tanstack/react-pacer", () => ({
	useDebouncedValue: (value: string) => [value, value] as const,
}));

vi.mock("@contextboard/editor", () => ({
	ReadonlyRichTextPreview: () => <div data-testid="readonly-preview" />,
}));

vi.mock("../cards/CardPreviewDialog", () => ({
	CardPreviewDialog: ({
		cardId,
		currentWhiteboardId,
	}: {
		cardId: string | null;
		currentWhiteboardId: string | null;
	}) =>
		cardId ? (
			<div
				data-testid="card-preview-dialog"
				data-card-id={cardId}
				data-current-whiteboard-id={currentWhiteboardId ?? ""}
			/>
		) : null,
}));

vi.mock("../ui/dialog", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	const DialogContext = React.createContext<{
		onOpenChange?: (open: boolean) => void;
	} | null>(null);

	return {
		Dialog: ({
			open,
			onOpenChange,
			children,
		}: {
			open: boolean;
			onOpenChange?: (open: boolean) => void;
			children: ReactNode;
		}) =>
			open ? (
				<DialogContext.Provider value={{ onOpenChange }}>
					{children}
				</DialogContext.Provider>
			) : null,
		DialogContent: ({ children }: { children: ReactNode }) => {
			const context = React.useContext(DialogContext);

			return (
				<div
					data-testid="dialog-content"
					onKeyDown={(event) => {
						if (event.key === "Escape") context?.onOpenChange?.(false);
					}}
				>
					{children}
				</div>
			);
		},
		DialogHeader: ({ children }: { children: ReactNode }) => (
			<div>{children}</div>
		),
		DialogTitle: ({ children }: { children: ReactNode }) => (
			<div>{children}</div>
		),
		DialogDescription: ({ children }: { children: ReactNode }) => (
			<div>{children}</div>
		),
	};
});

const runtime = {
	platform: "desktop",
	workspaceId: "test-workspace",
	cards: {
		subscribe: () => () => undefined,
	},
	search: {
		search: searchMock,
	},
	navigation: {
		cardsHref: () => "/cards",
		cardHref: (cardId: string) => `/cards/${cardId}`,
		rootWhiteboardHref: () => "/whiteboard",
		whiteboardHref: (whiteboardId: string) => `/whiteboard/${whiteboardId}`,
		navigate: navigateMock,
		replace: vi.fn(),
	},
} as unknown as ApplicationRuntime;

let searchResults: SearchResults;

function renderPalette(currentWhiteboardId: string | null = null) {
	return render(
		<ApplicationRuntimeProvider runtime={runtime}>
			<CommandPalette currentWhiteboardId={currentWhiteboardId} />
		</ApplicationRuntimeProvider>,
	);
}

describe("CommandPalette", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		searchMock.mockReset();
		searchResults = { cards: [], whiteboards: [] };
		searchMock.mockImplementation(async () => searchResults);
	});

	afterEach(() => {
		cleanup();
	});

	test("opens global search from Ctrl+O and preserves the query", async () => {
		renderPalette();

		fireEvent.keyDown(window, { key: "o", ctrlKey: true });
		const input = await screen.findByPlaceholderText(
			"Search all cards & whiteboards",
		);
		fireEvent.change(input, { target: { value: "apollo" } });

		expect((input as HTMLInputElement).value).toBe("apollo");

		fireEvent.keyDown(input, { key: "Escape" });
		await waitFor(() =>
			expect(
				screen.queryByPlaceholderText("Search all cards & whiteboards"),
			).toBeNull(),
		);

		fireEvent.keyDown(window, { key: "o", ctrlKey: true });
		const reopenedInput = await screen.findByPlaceholderText(
			"Search all cards & whiteboards",
		);
		expect((reopenedInput as HTMLInputElement).value).toBe("apollo");
	});

	test("scopes Ctrl+P to the current whiteboard", async () => {
		renderPalette("board-1");

		fireEvent.keyDown(window, { key: "p", ctrlKey: true });
		await screen.findByPlaceholderText(
			"Search cards & sub-whiteboards on this board",
		);

		await waitFor(() =>
			expect(searchMock).toHaveBeenCalledWith({
				term: "",
				whiteboardId: "board-1",
			}),
		);
	});

	test("opens a selected whiteboard through runtime navigation", async () => {
		searchResults = {
			cards: [],
			whiteboards: [
				{
					kind: "whiteboard",
					id: "board-2",
					title: "Research board",
					boardWhiteboardId: null,
					shapeId: null,
				},
			],
		};
		renderPalette();

		fireEvent.keyDown(window, { key: "o", ctrlKey: true });
		fireEvent.click(await screen.findByText("Research board"));

		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith("/whiteboard/board-2"),
		);
	});

	test("opens a selected card in the preview dialog", async () => {
		searchResults = {
			whiteboards: [],
			cards: [
				{
					kind: "card",
					id: "card-1",
					title: "Apollo notes",
					preview: "Mission notes",
					content: null,
					boardWhiteboardId: "board-1",
					shapeId: "shape-1",
				},
			],
		};
		renderPalette("board-1");

		fireEvent.keyDown(window, { key: "o", ctrlKey: true });
		fireEvent.click(await screen.findByText("Apollo notes"));

		const preview = await screen.findByTestId("card-preview-dialog");
		expect(preview.getAttribute("data-card-id")).toBe("card-1");
		expect(preview.getAttribute("data-current-whiteboard-id")).toBe("board-1");
	});
});
