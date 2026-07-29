import type { TableControlRect } from "./types";

function toLocalRect(
	rect: DOMRect,
	containerRect: DOMRect,
	container: HTMLElement,
	index: number,
): TableControlRect {
	return {
		index,
		left: rect.left - containerRect.left + container.scrollLeft,
		top: rect.top - containerRect.top + container.scrollTop,
		width: rect.width,
		height: rect.height,
	};
}

export function getLocalRect(
	element: HTMLElement,
	container: HTMLElement,
	index = 0,
): TableControlRect {
	return toLocalRect(
		element.getBoundingClientRect(),
		container.getBoundingClientRect(),
		container,
		index,
	);
}

export function getRowRects(
	table: HTMLElement,
	container: HTMLElement,
): TableControlRect[] {
	return Array.from(table.querySelectorAll("tr")).map((row, index) =>
		getLocalRect(row as HTMLElement, container, index),
	);
}

export function getColumnRects(
	table: HTMLElement,
	container: HTMLElement,
): TableControlRect[] {
	const firstRow = table.querySelector("tr");
	if (!firstRow) {
		return [];
	}

	return Array.from(firstRow.children)
		.filter((cell): cell is HTMLElement => cell instanceof HTMLElement)
		.map((cell, index) => getLocalRect(cell, container, index));
}
