// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CardDetailPage } from "./CardDetailPage";

const navigateMock = vi.fn();
const getMock = vi.fn();
const runtime = {
	cards: {
		get: getMock,
		subscribe: () => () => {},
		delete: vi.fn(),
		appendToWhiteboard: vi.fn(),
	},
	navigation: {
		cardsHref: () => "/cards",
		whiteboardHref: (id: string) => `/whiteboard/${id}`,
		navigate: navigateMock,
	},
	ui: {},
};
vi.mock("@contextboard/application", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/application")>()),
	useApplicationRuntime: () => runtime,
}));

vi.mock("../navigation/SidebarOpenButton", () => ({
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

const CARD_1 = "card_1";
const CARD_2 = "card_2";

function makeCardData(cardId: string) {
	return {
		id: cardId,
		title: `Card ${cardId}`,
		preview: "",
		content: { type: "doc", content: [] },
		createdAt: 1,
		updatedAt: 1,
		version: 1,
		activePlacementCount: 0,
		placements: [],
		backlinks: [],
		preferredPlacement: null,
		boardWhiteboardId: null,
		shapeId: null,
		breadcrumbs: [],
	};
}

describe("CardDetailPage", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		getMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	test("keeps the outer shell mounted while switching cards", async () => {
		getMock.mockImplementation(async (cardId: string) => makeCardData(cardId));

		const { rerender } = render(<CardDetailPage cardId={CARD_1} />);
		const shell = screen.getByTestId("card-detail-page");

		expect(await screen.findByText("Card card_1")).not.toBeNull();
		expect(
			screen.getByTestId("card-detail-document-surface").textContent,
		).toBe("card_1");

		rerender(<CardDetailPage cardId={CARD_2} />);

		expect(screen.getByTestId("card-detail-page")).toBe(shell);
		expect(await screen.findByText("Card card_2")).not.toBeNull();
		expect(
			screen.getByTestId("card-detail-document-surface").textContent,
		).toBe("card_2");
	});

	test("resets the app scroll host when switching cards", async () => {
		getMock.mockImplementation(async (cardId: string) => makeCardData(cardId));

		const scrollHost = document.createElement("div");
		scrollHost.setAttribute("data-app-scroll-host", "true");
		scrollHost.scrollTo = vi.fn();
		document.body.appendChild(scrollHost);

		const { rerender } = render(<CardDetailPage cardId={CARD_1} />);
		(scrollHost.scrollTo as ReturnType<typeof vi.fn>).mockClear();

		rerender(<CardDetailPage cardId={CARD_2} />);

		await waitFor(() =>
			expect(scrollHost.scrollTo).toHaveBeenCalledWith({ top: 0 }),
		);
		scrollHost.remove();
	});
});
