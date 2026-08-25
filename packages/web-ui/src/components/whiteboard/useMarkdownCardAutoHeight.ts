import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useEditor } from "tldraw";
import { useCompleteCardHeightMeasurement } from "./CardHeightMeasurementContext";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import { resolveMarkdownCardHeight } from "./markdown-card-sizing";

function isMarkdownCardVisible(card: HTMLDivElement | null) {
	return Boolean(card && card.getClientRects().length > 0);
}

export function useMarkdownCardAutoHeight({
	shape,
	minHeight,
	isEditing,
}: {
	shape: MarkdownCardShape;
	minHeight: number;
	isEditing: boolean;
}) {
	const editor = useEditor();
	const completeHeightMeasurement = useCompleteCardHeightMeasurement();
	const cardRef = useRef<HTMLDivElement>(null);
	const latestPropsRef = useRef(shape.props);
	const syncFrameRef = useRef<number | null>(null);
	const measurementInFlightRef = useRef(false);
	const [isContentReady, setIsContentReady] = useState(false);
	latestPropsRef.current = shape.props;

	const measureNextHeight = useCallback(() => {
		const latestProps = latestPropsRef.current;
		const card = cardRef.current;

		return resolveMarkdownCardHeight({
			currentHeight: latestProps.h,
			measuredScrollHeight: card ? Math.ceil(card.scrollHeight) : null,
			minHeight,
			isContentReady,
			isVisible: isMarkdownCardVisible(card),
		});
	}, [isContentReady, minHeight]);

	// Persisted content renders empty until hydration finishes. Measuring before
	// then would permanently complete the one-shot at the minimum height. This
	// component only mounts after the card content store is ready, and onReady
	// confirms that the renderer committed that content to the DOM.
	const canMeasureOnce =
		isContentReady &&
		shape.props.heightMeasurementPending === true &&
		completeHeightMeasurement !== null;

	const syncHeight = useCallback(() => {
		syncFrameRef.current = null;
		const latestProps = latestPropsRef.current;
		const nextHeight = measureNextHeight();

		if (!isEditing) {
			if (!isMarkdownCardVisible(cardRef.current)) return;
			if (!completeHeightMeasurement || measurementInFlightRef.current) return;

			measurementInFlightRef.current = true;
			void completeHeightMeasurement(shape.id, nextHeight)
				.catch(() => undefined)
				.finally(() => {
					measurementInFlightRef.current = false;
				});
			return;
		}

		if (Math.abs(nextHeight - latestProps.h) < 1) return;

		editor.updateShape<MarkdownCardShape>({
			id: shape.id,
			type: "markdown-card",
			props: {
				...latestProps,
				h: nextHeight,
			},
		});
	}, [
		completeHeightMeasurement,
		editor,
		isEditing,
		measureNextHeight,
		shape.id,
	]);

	const scheduleSyncHeight = useCallback(() => {
		// Editing drives height continuously. A non-editing card gets one write only
		// when its persisted placement is waiting for a real DOM measurement.
		if (!isEditing && !canMeasureOnce) return;
		if (syncFrameRef.current !== null) return;
		syncFrameRef.current = window.requestAnimationFrame(syncHeight);
	}, [canMeasureOnce, isEditing, syncHeight]);

	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card || !isEditing) return;

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
	}, [isEditing, scheduleSyncHeight]);

	useEffect(() => {
		if (!isContentReady) return;
		scheduleSyncHeight();
	}, [isContentReady, scheduleSyncHeight]);

	useEffect(
		() => () => {
			if (syncFrameRef.current !== null) {
				window.cancelAnimationFrame(syncFrameRef.current);
				syncFrameRef.current = null;
			}
		},
		[],
	);

	return {
		cardRef,
		isContentReady,
		setIsContentReady,
	};
}
