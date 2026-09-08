import { useCallback, useEffect, useState } from "react";
import { getCardGridMetrics } from "./cardGridGeometry";

const OVERSCAN_ROWS = 2;

type GridWindow = {
	firstIndex: number;
	lastIndex: number;
	paddingTop: number;
	paddingBottom: number;
	width: number;
};

const emptyWindow: GridWindow = {
	firstIndex: 0,
	lastIndex: 0,
	paddingTop: 0,
	paddingBottom: 0,
	width: 0,
};

export function useUniformGridWindow(itemCount: number) {
	const [gridElement, setGridElement] = useState<HTMLUListElement | null>(null);
	const [windowState, setWindowState] = useState<GridWindow>(emptyWindow);
	const metrics = getCardGridMetrics(windowState.width);

	const gridRef = useCallback((node: HTMLUListElement | null) => {
		setGridElement(node);
	}, []);

	useEffect(() => {
		if (!gridElement) {
			setWindowState(emptyWindow);
			return;
		}

		const scrollHost = gridElement.closest<HTMLElement>(
			"[data-app-scroll-host='true']",
		);
		const measure = () => {
			const gridRect = gridElement.getBoundingClientRect();
			const hostRect = scrollHost?.getBoundingClientRect();
			const width = gridRect.width;
			const nextMetrics = getCardGridMetrics(width);
			const rowCount = Math.ceil(itemCount / nextMetrics.columns);

			if (!scrollHost || !hostRect || width === 0 || hostRect.height === 0) {
				setWindowState({
					firstIndex: 0,
					lastIndex: itemCount,
					paddingTop: 0,
					paddingBottom: 0,
					width,
				});
				return;
			}

			const firstRow = Math.min(
				Math.max(0, rowCount - 1),
				Math.max(
					0,
					Math.floor((hostRect.top - gridRect.top) / nextMetrics.rowStride) -
						OVERSCAN_ROWS,
				),
			);
			const lastRow = Math.min(
				Math.max(0, rowCount - 1),
				Math.floor((hostRect.bottom - gridRect.top) / nextMetrics.rowStride) +
					OVERSCAN_ROWS,
			);
			const firstIndex = firstRow * nextMetrics.columns;
			const lastIndex = Math.min(
				itemCount,
				(lastRow + 1) * nextMetrics.columns,
			);

			setWindowState({
				firstIndex,
				lastIndex,
				paddingTop: firstRow * nextMetrics.rowStride,
				paddingBottom:
					Math.max(0, rowCount - lastRow - 1) * nextMetrics.rowStride,
				width,
			});
		};

		measure();
		scrollHost?.addEventListener("scroll", measure, { passive: true });
		window.addEventListener("resize", measure);
		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		resizeObserver?.observe(gridElement);
		if (scrollHost) resizeObserver?.observe(scrollHost);

		return () => {
			scrollHost?.removeEventListener("scroll", measure);
			window.removeEventListener("resize", measure);
			resizeObserver?.disconnect();
		};
	}, [gridElement, itemCount]);

	return {
		gridRef,
		gridElement,
		metrics,
		...windowState,
		lastIndex: windowState.width === 0 ? itemCount : windowState.lastIndex,
	};
}
