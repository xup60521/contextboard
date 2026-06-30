import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useEditor } from "tldraw";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import { resolveMarkdownCardHeight } from "./markdown-card-sizing";

function isMarkdownCardVisible(card: HTMLDivElement | null) {
	return Boolean(card && card.getClientRects().length > 0);
}

export function useMarkdownCardAutoHeight({
	shape,
	headerHeight,
	minHeight,
}: {
	shape: MarkdownCardShape;
	headerHeight: number;
	minHeight: number;
}) {
	const editor = useEditor();
	const cardRef = useRef<HTMLDivElement>(null);
	const latestPropsRef = useRef(shape.props);
	const syncFrameRef = useRef<number | null>(null);
	const [isContentReady, setIsContentReady] = useState(false);
	latestPropsRef.current = shape.props;

	const measureNextHeight = useCallback(() => {
		const latestProps = latestPropsRef.current;
		const card = cardRef.current;

		return resolveMarkdownCardHeight({
			currentHeight: latestProps.h,
			measuredScrollHeight: card ? Math.ceil(card.scrollHeight) : null,
			headerHeight,
			minHeight,
			isContentReady,
			isVisible: isMarkdownCardVisible(card),
		});
	}, [headerHeight, isContentReady, minHeight]);

	const syncHeight = useCallback(() => {
		syncFrameRef.current = null;
		const latestProps = latestPropsRef.current;
		const nextHeight = measureNextHeight();

		if (Math.abs(nextHeight - latestProps.h) < 1) {
			return;
		}

		editor.updateShape<MarkdownCardShape>({
			id: shape.id,
			type: "markdown-card",
			props: {
				...latestProps,
				h: nextHeight,
			},
		});
	}, [editor, measureNextHeight, shape.id]);

	const scheduleSyncHeight = useCallback(() => {
		if (syncFrameRef.current !== null) return;
		syncFrameRef.current = window.requestAnimationFrame(syncHeight);
	}, [syncHeight]);

	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card) return;

		scheduleSyncHeight();

		const resizeObserver = new ResizeObserver(scheduleSyncHeight);
		resizeObserver.observe(card);

		return () => {
			resizeObserver.disconnect();
			if (syncFrameRef.current !== null) {
				window.cancelAnimationFrame(syncFrameRef.current);
				syncFrameRef.current = null;
			}
		};
	}, [scheduleSyncHeight]);

	useEffect(() => {
		if (!isContentReady) return;
		scheduleSyncHeight();
	}, [isContentReady, scheduleSyncHeight]);

	return {
		cardRef,
		isContentReady,
		setIsContentReady,
		latestPropsRef,
		measureNextHeight,
		scheduleSyncHeight,
	};
}
