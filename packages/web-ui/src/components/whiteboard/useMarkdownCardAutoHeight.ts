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
import {
	hasMeasuredCardHeight,
	markCardHeightMeasured,
} from "./measured-card-heights";

function isMarkdownCardVisible(card: HTMLDivElement | null) {
	return Boolean(card && card.getClientRects().length > 0);
}

/**
 * A card created without a DOM only ever had an estimated height, so the first
 * real render is worth one correction. Anything below this is rounding noise
 * between devices and not worth the frame-sync traffic on every board load.
 */
const ONE_SHOT_MIN_DELTA = 4;

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
			minHeight,
			isContentReady,
			isVisible: isMarkdownCardVisible(card),
		});
	}, [isContentReady, minHeight]);

	// A card whose content has not been hydrated yet renders empty, and measuring
	// that would shrink the shape to its minimum. Local cards carry no
	// `contentLoaded` flag because their content is always present.
	const canMeasureOnce =
		isContentReady &&
		shape.props.contentLoaded !== false &&
		!hasMeasuredCardHeight(shape.id);

	const syncHeight = useCallback(() => {
		syncFrameRef.current = null;
		const latestProps = latestPropsRef.current;
		const nextHeight = measureNextHeight();
		const isOneShot = !isEditing;
		if (isOneShot) {
			// An off-screen card measures as nothing, so that attempt does not count
			// — the shot stays available for when the card is actually on screen.
			if (!isMarkdownCardVisible(cardRef.current)) return;
			// Otherwise claim it before writing, so the re-render caused by the write
			// itself cannot schedule a second measurement.
			markCardHeightMeasured(shape.id);
		}

		if (
			Math.abs(nextHeight - latestProps.h) <
			(isOneShot ? ONE_SHOT_MIN_DELTA : 1)
		) {
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
	}, [editor, isEditing, measureNextHeight, shape.id]);

	const scheduleSyncHeight = useCallback(() => {
		// The editing card drives its own height continuously. A non-editing card
		// gets exactly one measurement, to replace the height an agent could only
		// estimate: after blur the editor is swapped for the static renderer, and
		// letting the ResizeObserver keep writing `h` here re-fires the
		// content-hydration reactive on every frame, which (combined with the other
		// shape writers) never settles and freezes the app.
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

	// The one-shot measurement can be in flight while the card is not editing, so
	// it is not covered by the observer effect's cleanup above.
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
