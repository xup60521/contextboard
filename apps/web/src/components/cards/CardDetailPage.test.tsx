import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CardDetailPage } from "./CardDetailPage";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("convex/react", () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
	useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("#/components/navigation/SidebarOpenButton", () => ({
	SidebarOpenButton: () => <button type="button">Sidebar</button>,
}));

vi.mock("./CardDetailDocumentSurface", () => ({
	CardDetailDocumentSurface: ({ cardId }: { cardId: string }) => (
		<div data-testid="card-detail-document-surface">{cardId}</div>
	),
}));

vi.mock("./CardInfoSection", () => ({
	CardInfoSection: () => <div data-testid="card-info-section" />,
}));

vi.mock("../whiteboard/WhiteboardPickerDialog", () => ({
	WhiteboardPickerDialog: ({ open }: { open: boolean }) =>
		open ? <div data-testid="whiteboard-picker" /> : null,
}));

vi.mock("../ui/dialog", () => ({
	Dialog: ({
		open,
		children,
	}: {
		open: boolean;
		children: ReactNode;
	}) => (open ? <div>{children}</div> : null),
	DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("../ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({
		children,
		onSelect,
	}: {
		children: ReactNode;
		onSelect?: () => void;
	}) => <button onClick={onSelect}>{children}</button>,
}));

vi.mock("../ui/button", () => ({
	Button: ({
		children,
		onClick,
	}: {
		children: ReactNode;
		onClick?: () => void;
	}) => <button onClick={onClick}>{children}</button>,
}));

const CARD_1 = "card_1" as Id<"cards">;
const CARD_2 = "card_2" as Id<"cards">;

function makeCardData(cardId: Id<"cards">) {
	return {
		card: {
			_id: cardId,
			_creationTime: 1,
			content: { type: "doc", content: [] },
			derivedTitle: `Card ${cardId}`,
			plainText: "",
			updatedAt: 1,
		},
		placements: [],
		backlinks: [],
		boardWhiteboardId: null,
	};
}

describe("CardDetailPage", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		useQueryMock.mockReset();
		useMutationMock.mockReset();
		useMutationMock.mockReturnValue(vi.fn());
	});

	afterEach(() => {
		cleanup();
	});

	test("keeps the outer shell mounted while switching cards", () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args && typeof args === "object" && "cardId" in (args as object)) {
				return makeCardData((args as { cardId: Id<"cards"> }).cardId);
			}

			return [];
		});

		const { rerender } = render(<CardDetailPage cardId={CARD_1} />);
		const shell = screen.getByTestId("card-detail-page");

		expect(screen.getByText("Card card_1")).not.toBeNull();
		expect(
			screen.getByTestId("card-detail-document-surface").textContent,
		).toBe("card_1");

		rerender(<CardDetailPage cardId={CARD_2} />);

		expect(screen.getByTestId("card-detail-page")).toBe(shell);
		expect(screen.getByText("Card card_2")).not.toBeNull();
		expect(
			screen.getByTestId("card-detail-document-surface").textContent,
		).toBe("card_2");
	});

	test("resets the app scroll host when switching cards", () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args && typeof args === "object" && "cardId" in (args as object)) {
				return makeCardData((args as { cardId: Id<"cards"> }).cardId);
			}

			return [];
		});

		const scrollHost = document.createElement("div");
		scrollHost.setAttribute("data-app-scroll-host", "true");
		scrollHost.scrollTo = vi.fn();
		document.body.appendChild(scrollHost);

		const { rerender } = render(<CardDetailPage cardId={CARD_1} />);
		(scrollHost.scrollTo as ReturnType<typeof vi.fn>).mockClear();

		rerender(<CardDetailPage cardId={CARD_2} />);

		expect(scrollHost.scrollTo).toHaveBeenCalledWith({ top: 0 });
		scrollHost.remove();
	});
});
