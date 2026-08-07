import {
	normalizeImageSources,
	serializeCardContent,
} from "@contextboard/application";
import { StaticRichTextRenderer } from "@contextboard/editor";
import type { JSONContent } from "@tiptap/core";
import { useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useIsEditing } from "tldraw";
import { whiteboardPreviewCardIdAtom } from "../../lib/atoms";
import { CardDocumentEditor } from "../cards/CardDocumentEditor";
import { useDebouncedCardSave } from "../cards/useDebouncedCardSave";
import { useCardContentEntry, useCardContentStore } from "./card-content-store";
import type { Id } from "./ids";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import {
	isEmptyCardContent,
	MarkdownCardOpenLink,
	MarkdownCardShell,
} from "./MarkdownCardShell";
import { useWhiteboardNavigation } from "./navigation";
import { useMarkdownCardAutoHeight } from "./useMarkdownCardAutoHeight";
import { WhiteboardCardContext } from "./WhiteboardCardContext";

const MIN_HEIGHT = 96;

export function PersistedMarkdownCardComponent({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const isEditing = useIsEditing(shape.id);
	const navigation = useWhiteboardNavigation();
	const cardId = shape.props.cardId as Id<"cards">;
	const boardWhiteboardId = useContext(WhiteboardCardContext);
	const openWhiteboardPreview = useSetAtom(whiteboardPreviewCardIdAtom);
	const contentStore = useCardContentStore();
	const contentEntry = useCardContentEntry(cardId);
	const currentContent = useMemo(
		() => contentEntry.draft ?? contentEntry.persistedDocument,
		[contentEntry.draft, contentEntry.persistedDocument],
	);
	const {
		scheduleSave: schedulePersistedSave,
		flushSave,
		error: saveError,
	} = useDebouncedCardSave(cardId, 450, {
		initialContent: currentContent,
		initialSerialized: contentEntry.draftSerialized,
		initialVersion:
			contentEntry.persistedVersion ?? shape.props.contentVersion ?? null,
		onPersisted: ({ content, serialized, version }) => {
			contentStore.acknowledge(
				cardId,
				content,
				version,
				serialized ?? serializeCardContent(content),
			);
		},
	});
	useEffect(() => {
		if (saveError) contentStore.setError(cardId, saveError);
	}, [cardId, contentStore, saveError]);
	const { cardRef, setIsContentReady } = useMarkdownCardAutoHeight({
		shape,
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
			const content = normalizeImageSources(value);
			const serialized = serializeCardContent(content);
			contentStore.setDraft(cardId, content, serialized);
			schedulePersistedSave({ content, serialized });
		},
		[cardId, contentStore, schedulePersistedSave],
	);

	return (
		<MarkdownCardShell
			shape={shape}
			isEditing={isEditing}
			contentRef={cardRef}
			contentClassName="w-full px-8 py-8"
			header={
				<MarkdownCardOpenLink
					href={navigation.cardHref(cardId)}
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
