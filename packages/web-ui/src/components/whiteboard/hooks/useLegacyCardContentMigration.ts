import {
	DEFAULT_CARD_CONTENT,
	serializeCardContent,
	useApplicationRuntime,
} from "@contextboard/application";
import type { JSONContent } from "@tiptap/core";
import { useEffect, useState } from "react";
import type { Editor, TLShapePartial } from "tldraw";
import type { CardContentStore } from "../card-content-store";
import { parseMarkdownContent } from "../MarkdownCardShell";
import { isMarkdownCardShape } from "../whiteboard-canvas-helpers";

/**
 * Moves bodies from legacy tldraw props into their authoritative stores before
 * item reconciliation is allowed to replace those shapes.
 */
export function useLegacyCardContentMigration({
	editor,
	loadedDrawingKey,
	whiteboardKey,
	contentStore,
}: {
	editor: Editor | null;
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	contentStore: CardContentStore;
}) {
	const { cards } = useApplicationRuntime();
	const [readyKey, setReadyKey] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);

	// `retry` is an explicit timer-driven trigger after a failed durable migration.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the value intentionally retriggers this effect.
	useEffect(() => {
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		let cancelled = false;
		let retryTimer: number | null = null;
		setReadyKey(null);

		void (async () => {
			const legacyShapes = editor
				.getCurrentPageShapes()
				.filter(isMarkdownCardShape)
				.filter((shape) => typeof shape.props.content === "string");
			if (legacyShapes.length === 0) {
				if (!cancelled) setReadyKey(whiteboardKey);
				return;
			}

			try {
				for (const shape of legacyShapes) {
					const legacyDocument =
						parseMarkdownContent(shape.props.content) ??
						(DEFAULT_CARD_CONTENT as JSONContent);
					if (!shape.props.cardId) {
						contentStore.setDraft(
							shape.id,
							legacyDocument,
							serializeCardContent(legacyDocument),
						);
						continue;
					}
					const migrated = await cards.ensureLegacyContent({
						cardId: shape.props.cardId,
						content: legacyDocument,
						contentVersion: shape.props.contentVersion,
					});
					contentStore.setPersisted(
						shape.props.cardId,
						migrated.content,
						migrated.version,
						serializeCardContent(migrated.content),
					);
				}
				if (cancelled) return;
				editor.run(
					() => {
						editor.updateShapes(
							legacyShapes.map((shape) => ({
								id: shape.id,
								type: "markdown-card" as const,
								props: { content: undefined },
							})) as TLShapePartial[],
						);
					},
					{ history: "ignore" },
				);
				setReadyKey(whiteboardKey);
			} catch (error) {
				console.warn("Failed to migrate legacy card content", error);
				if (!cancelled)
					retryTimer = window.setTimeout(
						() => setRetry((value) => value + 1),
						2_000,
					);
			}
		})();

		return () => {
			cancelled = true;
			if (retryTimer !== null) window.clearTimeout(retryTimer);
		};
	}, [cards, contentStore, editor, loadedDrawingKey, retry, whiteboardKey]);

	return readyKey === whiteboardKey;
}
