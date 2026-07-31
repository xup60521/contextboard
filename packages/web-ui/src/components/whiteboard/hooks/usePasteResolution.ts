import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { Editor, TLShapeId, TLUiEventHandler } from "tldraw";
import type { MarkdownCardShape } from "../custom-shapes";
import type { Id } from "../ids";
import { isMarkdownCardShape } from "../whiteboard-canvas-helpers";

export type PastePlacement = "link" | "duplicate";

type RestoreOrAdoptCardItem = (input: {
	whiteboardId: Id<"whiteboards"> | null;
	shapeId: string;
	sourceCardId?: string | null;
	sourceWorkspaceId?: string | null;
	placement?: "auto" | "link" | "duplicate";
	content?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
}) => Promise<unknown>;

type PastedCard = {
	shapeId: string;
	sourceCardId?: string;
	sourceWorkspaceId?: string;
	content: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
};

export type PendingPasteResolution = {
	cards: number;
	anchor: { x: number; y: number };
};

function snapshotCard(shape: MarkdownCardShape): PastedCard {
	return {
		shapeId: shape.id,
		sourceCardId: shape.props.cardId,
		sourceWorkspaceId: shape.props.originWorkspaceId,
		content: shape.props.content,
		x: shape.x,
		y: shape.y,
		w: shape.props.w,
		h: shape.props.h,
		rotation: shape.rotation,
	};
}

function isTrustedCard(card: PastedCard, workspaceId: string) {
	return (
		workspaceId.length > 0 &&
		typeof card.sourceCardId === "string" &&
		card.sourceCardId.length > 0 &&
		card.sourceWorkspaceId === workspaceId
	);
}

export function usePasteResolution({
	editor,
	whiteboardId,
	workspaceId,
	restoreOrAdoptCardItem,
	protectedPasteShapeIdsRef,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	workspaceId: string;
	restoreOrAdoptCardItem: RestoreOrAdoptCardItem;
	protectedPasteShapeIdsRef: MutableRefObject<Set<string>>;
}) {
	const [pending, setPending] = useState<PendingPasteResolution | null>(null);
	const pendingRef = useRef<
		(PendingPasteResolution & { cardsData: PastedCard[] }) | null
	>(null);
	const pasteIntentCountRef = useRef(0);
	const editorRef = useRef(editor);
	const restoreRef = useRef(restoreOrAdoptCardItem);

	editorRef.current = editor;
	restoreRef.current = restoreOrAdoptCardItem;

	const sanitizeForDuplicate = useCallback((shapeId: string) => {
		const currentEditor = editorRef.current;
		if (!currentEditor) return;
		const shape = currentEditor.getShape(shapeId as TLShapeId);
		if (!shape || shape.type !== "markdown-card") return;

		currentEditor.updateShape({
			id: shape.id,
			type: "markdown-card",
			props: {
				...shape.props,
				cardId: undefined,
				originWorkspaceId: undefined,
				title: undefined,
				preview: undefined,
				contentLoaded: undefined,
				contentVersion: undefined,
			},
		});
	}, []);

	const persistCard = useCallback(
		async (card: PastedCard, placement: "auto" | PastePlacement) => {
			const currentShape = editorRef.current?.getShape(
				card.shapeId as TLShapeId,
			);
			if (editorRef.current && !currentShape) {
				protectedPasteShapeIdsRef.current.delete(card.shapeId as TLShapeId);
				return;
			}
			const latestCard =
				currentShape && isMarkdownCardShape(currentShape)
					? snapshotCard(currentShape)
					: card;
			if (placement === "duplicate") sanitizeForDuplicate(latestCard.shapeId);

			try {
				await restoreRef.current({
					whiteboardId,
					shapeId: latestCard.shapeId,
					sourceCardId:
						placement === "duplicate" ? undefined : latestCard.sourceCardId,
					sourceWorkspaceId:
						placement === "duplicate"
							? undefined
							: latestCard.sourceWorkspaceId,
					placement,
					content: latestCard.content,
					x: latestCard.x,
					y: latestCard.y,
					w: latestCard.w,
					h: latestCard.h,
					rotation: latestCard.rotation,
				});
			} catch (error) {
				protectedPasteShapeIdsRef.current.delete(card.shapeId as TLShapeId);
				console.warn("Failed to persist pasted card", error);
			}
		},
		[protectedPasteShapeIdsRef, sanitizeForDuplicate, whiteboardId],
	);

	const commitPending = useCallback(
		async (placement: PastePlacement) => {
			const current = pendingRef.current;
			if (!current) return;
			pendingRef.current = null;
			setPending(null);

			// Sequential writes avoid competing revisions when several pasted
			// shapes point at the same source card.
			for (const card of current.cardsData) {
				await persistCard(card, placement);
			}
		},
		[persistCard],
	);
	const commitPendingRef = useRef(commitPending);
	commitPendingRef.current = commitPending;

	const handleUiEvent = useCallback<TLUiEventHandler>((name) => {
		if (name === "paste") pasteIntentCountRef.current += 1;
	}, []);

	const consumePasteIntent = useCallback(() => {
		if (pasteIntentCountRef.current === 0) return false;
		pasteIntentCountRef.current -= 1;
		return true;
	}, []);

	const handleAddedCards = useCallback(
		(cards: MarkdownCardShape[], isPaste: boolean) => {
			if (!whiteboardId || cards.length === 0) return;

			const snapshots = cards.map(snapshotCard);
			if (!isPaste) {
				for (const card of snapshots) void persistCard(card, "auto");
				return;
			}

			for (const card of snapshots) {
				protectedPasteShapeIdsRef.current.add(card.shapeId as TLShapeId);
			}

			if (pendingRef.current) void commitPending("link");

			const trusted = snapshots.filter((card) =>
				isTrustedCard(card, workspaceId),
			);
			const unsafe = snapshots.filter(
				(card) => !isTrustedCard(card, workspaceId),
			);
			for (const card of unsafe) void persistCard(card, "duplicate");

			if (trusted.length === 0) return;

			const currentEditor = editorRef.current;
			const first = trusted[0];
			const screenPoint = currentEditor?.pageToScreen({
				x: first.x,
				y: first.y,
			}) ?? { x: 24, y: 24 };
			const next = {
				cards: trusted.length,
				anchor: {
					x: Math.max(16, screenPoint.x),
					y: Math.max(16, screenPoint.y + 12),
				},
				cardsData: trusted,
			};
			pendingRef.current = next;
			setPending(next);
		},
		[
			commitPending,
			persistCard,
			protectedPasteShapeIdsRef,
			whiteboardId,
			workspaceId,
		],
	);

	const handleRemovedCards = useCallback(
		(shapeIds: string[]) => {
			for (const shapeId of shapeIds) {
				protectedPasteShapeIdsRef.current.delete(shapeId as TLShapeId);
			}

			const current = pendingRef.current;
			if (!current) return;
			const removed = new Set(shapeIds);
			const remaining = current.cardsData.filter(
				(card) => !removed.has(card.shapeId),
			);
			if (remaining.length === current.cardsData.length) return;
			if (remaining.length === 0) {
				pendingRef.current = null;
				setPending(null);
				return;
			}
			const next = {
				cards: remaining.length,
				anchor: current.anchor,
				cardsData: remaining,
			};
			pendingRef.current = next;
			setPending(next);
		},
		[protectedPasteShapeIdsRef],
	);

	// The cleanup intentionally runs both when the board changes and when the
	// whiteboard unmounts, so an unresolved paste always takes the safe default.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on whiteboardId for cleanup
	useEffect(() => {
		return () => {
			pasteIntentCountRef.current = 0;
			void commitPendingRef.current("link");
		};
	}, [whiteboardId]);

	return {
		pending,
		handleUiEvent,
		consumePasteIntent,
		handleAddedCards,
		handleRemovedCards,
		resolvePending: commitPending,
	};
}
