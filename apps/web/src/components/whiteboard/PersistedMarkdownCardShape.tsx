import type { JSONContent } from "@tiptap/core";
import { useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useEditor, useIsEditing } from "tldraw";
import { CardDocumentEditor } from "#/components/cards/CardDocumentEditor";
import { useDebouncedCardSave } from "#/components/cards/useDebouncedCardSave";
import { StaticRichTextRenderer } from "#/components/editor/static-renderer";
import type { Id } from "#/integrations/local/types";
import { whiteboardPreviewCardIdAtom } from "../../lib/atoms";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import {
	isEmptyCardContent,
	MarkdownCardOpenLink,
	MarkdownCardShell,
	parseMarkdownContent,
} from "./MarkdownCardShell";
import { useMarkdownCardAutoHeight } from "./useMarkdownCardAutoHeight";
import { WhiteboardCardContext } from "./WhiteboardCardContext";
import { hydrateCardShapes } from "./whiteboard-canvas-helpers";

const HEADER_HEIGHT = 28;
const MIN_HEIGHT = 96;

export function PersistedMarkdownCardComponent({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const cardId = shape.props.cardId as Id<"cards">;
	const boardWhiteboardId = useContext(WhiteboardCardContext);
	const openWhiteboardPreview = useSetAtom(whiteboardPreviewCardIdAtom);
	const currentContent = useMemo(
		() => parseMarkdownContent(shape.props.content),
		[shape.props.content],
	);
	const { scheduleSave: schedulePersistedSave, flushSave } =
		useDebouncedCardSave(cardId, 450, {
			initialContent: currentContent,
			initialVersion: shape.props.contentVersion ?? null,
			onPersisted: ({ content, version }) => {
				hydrateCardShapes(editor, { cardId, content, version });
			},
		});
	const { cardRef, setIsContentReady, latestPropsRef, measureNextHeight } =
		useMarkdownCardAutoHeight({
			shape,
			headerHeight: HEADER_HEIGHT,
			minHeight: MIN_HEIGHT,
			isEditing,
		});

	// On tap-out the card stops being the editing shape, which removes the guard
	// that protects unsaved local content. Flush the pending save immediately so
	// the server version catches up and the dirty window closes promptly.
	const wasEditingRef = useRef(isEditing);
	useEffect(() => {
		if (wasEditingRef.current && !isEditing) {
			flushSave();
		}
		wasEditingRef.current = isEditing;
	}, [isEditing, flushSave]);
	const staticContent = currentContent;
	const selectInitialContent = isEmptyCardContent(currentContent);

	const scheduleSave = useCallback(
		(value: JSONContent) => {
			const serializedContent = JSON.stringify(value);
			const latestProps = latestPropsRef.current;
			const nextHeight = measureNextHeight();

			editor.run(
				() => {
					editor.updateShape<MarkdownCardShape>({
						id: shape.id,
						type: "markdown-card",
						props: {
							...latestProps,
							content: serializedContent,
							h: nextHeight,
						},
					});
				},
				{ history: "ignore" },
			);

			schedulePersistedSave(value);
		},
		[
			editor,
			latestPropsRef,
			measureNextHeight,
			schedulePersistedSave,
			shape.id,
		],
	);

	return (
		<MarkdownCardShell
			shape={shape}
			isEditing={isEditing}
			contentRef={cardRef}
			contentClassName="w-full px-8 py-8"
			header={
				<MarkdownCardOpenLink
					to="/cards/$cardId"
					params={{ cardId }}
					ariaLabel="Open card editor"
				/>
			}
		>
			{isEditing ? (
				<CardDocumentEditor
					editable
					content={currentContent}
					whiteboardId={boardWhiteboardId}
					onOpenPreview={openWhiteboardPreview}
					contentClassName="min-h-12 pr-7"
					placeholder="Type '/' for commands"
					onChange={scheduleSave}
					onReady={() => setIsContentReady(true)}
					defaultFocusPosition={selectInitialContent ? "start" : "end"}
					selectContentOnFocus={selectInitialContent}
				/>
			) : (
				<StaticRichTextRenderer
					content={staticContent}
					contentClassName="min-h-12 pr-7"
					onReady={() => setIsContentReady(true)}
				/>
			)}
		</MarkdownCardShell>
	);
}
