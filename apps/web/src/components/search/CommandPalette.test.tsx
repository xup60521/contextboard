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
const useQueryMock = vi.fn();

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

vi.mock("@tanstack/react-pacer", () => ({
	useDebouncedValue: (value: string) => [value, value] as const,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
	useParams: () => ({}),
}));

vi.mock("#/integrations/local/react", () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("#/components/editor/ReadonlyRichTextPreview", () => ({
	ReadonlyRichTextPreview: () => <div data-testid="readonly-preview" />,
}));

vi.mock("./CardPreviewDialog", () => ({
	CardPreviewDialog: ({ cardId }: { cardId: string | null }) =>
		cardId ? <div data-testid="card-preview-dialog" /> : null,
}));

vi.mock("#/components/ui/dialog", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	const ReactDOM =
		await vi.importActual<typeof import("react-dom")>("react-dom");
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

			return ReactDOM.createPortal(
				<div
					data-testid="dialog-content"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							context?.onOpenChange?.(false);
						}
					}}
				>
					{children}
				</div>,
				document.body,
			);
		},
	};
});

describe("CommandPalette", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		useQueryMock.mockReset();
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === "skip") {
				return undefined;
			}

			return { cards: [], whiteboards: [] };
		});
	});

	afterEach(() => {
		cleanup();
	});

	test("keeps the search query when the dialog closes and reopens", async () => {
		render(<CommandPalette />);

		fireEvent.keyDown(window, {
			key: "o",
			ctrlKey: true,
		});

		const input = await screen.findByPlaceholderText(
			"Search all cards & whiteboards…",
		);
		fireEvent.change(input, { target: { value: "apollo" } });

		expect((input as HTMLInputElement).value).toBe("apollo");

		fireEvent.keyDown(input, { key: "Escape" });

		await waitFor(() => {
			expect(
				screen.queryByPlaceholderText("Search all cards & whiteboards…"),
			).toBeNull();
		});

		fireEvent.keyDown(window, {
			key: "o",
			ctrlKey: true,
		});

		const reopenedInput = await screen.findByPlaceholderText(
			"Search all cards & whiteboards…",
		);
		expect((reopenedInput as HTMLInputElement).value).toBe("apollo");
	});
});
