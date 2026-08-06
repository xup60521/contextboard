// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	WhiteboardContextMenu,
	WhiteboardContextMenuContext,
} from "./WhiteboardContextMenu";

const { applyAutoArrangeMock, canAutoArrangeMock, useEditorMock } = vi.hoisted(
	() => ({
		applyAutoArrangeMock: vi.fn(),
		canAutoArrangeMock: vi.fn(),
		useEditorMock: vi.fn(),
	}),
);

vi.mock("tldraw", () => ({
	DefaultContextMenuContent: () => null,
	TldrawUiMenuGroup: ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	),
	TldrawUiMenuItem: ({
		id,
		label,
		onSelect,
	}: {
		id: string;
		label: ReactNode;
		onSelect?: () => void;
	}) => (
		<button type="button" data-testid={id} onClick={onSelect}>
			{label}
		</button>
	),
	TldrawUiMenuSubmenu: ({
		id,
		label,
		children,
	}: {
		id: string;
		label?: ReactNode;
		children?: ReactNode;
	}) => (
		<section data-testid={id}>
			<div>{label}</div>
			{children}
		</section>
	),
	useEditor: () => useEditorMock(),
}));

vi.mock("./ControlledTldrawContextMenu", () => ({
	ControlledTldrawContextMenu: ({ children }: { children?: ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("./auto-arrange", () => ({
	applyAutoArrange: applyAutoArrangeMock,
	canAutoArrange: canAutoArrangeMock,
}));

vi.mock("./navigation", () => ({
	useWhiteboardNavigation: () => ({
		openCard: vi.fn(),
		openWhiteboard: vi.fn(),
	}),
}));

vi.mock("./whiteboard-canvas-helpers", () => ({
	isMarkdownCardShape: () => false,
	isSubwhiteboardLinkShape: () => false,
}));

const editor = {
	getOnlySelectedShape: () => null,
	inputs: { currentPagePoint: { x: 0, y: 0 } },
};

function renderContextMenu() {
	return render(
		<WhiteboardContextMenuContext.Provider
			value={{
				createCardAt: null,
				createSubwhiteboardAt: vi.fn(),
				pointRef: { current: null },
			}}
		>
			<WhiteboardContextMenu {...({} as never)} />
		</WhiteboardContextMenuContext.Provider>,
	);
}

beforeEach(() => {
	useEditorMock.mockReturnValue(editor);
	canAutoArrangeMock.mockReturnValue(true);
	applyAutoArrangeMock.mockClear();
});

afterEach(() => {
	cleanup();
});

describe("WhiteboardContextMenu arrangement options", () => {
	test("hides card arrangement when the selection is not eligible", () => {
		canAutoArrangeMock.mockReturnValue(false);

		renderContextMenu();

		expect(screen.queryByTestId("arrange-cards")).toBeNull();
	});

	test("exposes every card arrangement style", () => {
		renderContextMenu();

		expect(screen.getByTestId("arrange-cards")).toBeTruthy();
		expect(screen.getByTestId("arrange-cards-auto")).toBeTruthy();
		expect(screen.getByTestId("arrange-cards-tree-horizontal")).toBeTruthy();
		expect(screen.getByTestId("arrange-cards-tree-vertical")).toBeTruthy();
		expect(screen.getByTestId("arrange-cards-mindmap")).toBeTruthy();
	});

	test.each([
		["arrange-cards-auto", "auto"],
		["arrange-cards-tree-horizontal", "tree-horizontal"],
		["arrange-cards-tree-vertical", "tree-vertical"],
		["arrange-cards-mindmap", "mindmap"],
	] as const)("passes %s to the arrange adapter", (id, style) => {
		renderContextMenu();

		fireEvent.click(screen.getByTestId(id));

		expect(applyAutoArrangeMock).toHaveBeenCalledWith(editor, style);
	});
});
