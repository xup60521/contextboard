import type { JSONContent } from "@tiptap/core";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type UseDebouncedCardSaveResult = {
	scheduleSave: (content: JSONContent) => void;
	flushSave: () => void;
};

function serializeContent(content: JSONContent | null | undefined) {
	return JSON.stringify(content ?? null);
}

export function useDebouncedCardSave(
	cardId: Id<"cards">,
	delayMs = 450,
	options?: {
		initialContent?: JSONContent | null;
		onPersisted?: (result: {
			content: JSONContent;
			version: number;
		}) => void;
	},
): UseDebouncedCardSaveResult {
	const updateContent = useMutation(api.cards.updateContent);
	const pendingSaveRef = useRef<{
		cardId: Id<"cards">;
		content: JSONContent;
		serializedContent: string;
	} | null>(null);
	const saveTimerRef = useRef<number | null>(null);
	const persistedSerializedByCardIdRef = useRef(
		new Map<Id<"cards">, string>(),
	);

	const flushSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const pendingSave = pendingSaveRef.current;
		pendingSaveRef.current = null;
		if (!pendingSave) return;

		const persistedSerialized = persistedSerializedByCardIdRef.current.get(
			pendingSave.cardId,
		);
		if (persistedSerialized === pendingSave.serializedContent) {
			return;
		}

		void Promise.resolve(
			updateContent({
				cardId: pendingSave.cardId,
				content: pendingSave.content,
			}),
		).then((version) => {
			persistedSerializedByCardIdRef.current.set(
				pendingSave.cardId,
				pendingSave.serializedContent,
			);
			options?.onPersisted?.({ content: pendingSave.content, version });
		});
	}, [options, updateContent]);

	const scheduleSave = useCallback(
		(content: JSONContent) => {
			const serializedContent = serializeContent(content);
			const persistedSerialized = persistedSerializedByCardIdRef.current.get(cardId);

			if (persistedSerialized === serializedContent) {
				pendingSaveRef.current = null;
				if (saveTimerRef.current !== null) {
					window.clearTimeout(saveTimerRef.current);
					saveTimerRef.current = null;
				}
				return;
			}

			pendingSaveRef.current = {
				cardId,
				content,
				serializedContent,
			};

			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}

			saveTimerRef.current = window.setTimeout(flushSave, delayMs);
		},
		[delayMs, flushSave],
	);

	useEffect(() => {
		persistedSerializedByCardIdRef.current.set(
			cardId,
			serializeContent(options?.initialContent),
		);
	}, [cardId, options?.initialContent]);

	useEffect(() => {
		return () => {
			flushSave();
		};
	}, [flushSave]);

	return { scheduleSave, flushSave };
}
