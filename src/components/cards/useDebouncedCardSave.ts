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
		initialVersion?: number | null;
		onPersisted?: (result: { content: JSONContent; version: number }) => void;
	},
): UseDebouncedCardSaveResult {
	const updateContent = useMutation(api.cards.updateContent);
	const initialContent = options?.initialContent;
	const initialVersion = options?.initialVersion;
	const initialContentRef = useRef(initialContent);
	const onPersistedRef = useRef(options?.onPersisted);
	const pendingSaveRef = useRef<{
		cardId: Id<"cards">;
		content: JSONContent;
		serializedContent: string;
	} | null>(null);
	const saveTimerRef = useRef<number | null>(null);
	const persistedSerializedByCardIdRef = useRef(new Map<Id<"cards">, string>());
	const persistedVersionByCardIdRef = useRef(new Map<Id<"cards">, number>());

	initialContentRef.current = initialContent;
	onPersistedRef.current = options?.onPersisted;

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
			if (typeof version === "number") {
				persistedVersionByCardIdRef.current.set(pendingSave.cardId, version);
			}
			onPersistedRef.current?.({ content: pendingSave.content, version });
		});
	}, [updateContent]);

	const scheduleSave = useCallback(
		(content: JSONContent) => {
			const serializedContent = serializeContent(content);
			const persistedSerialized =
				persistedSerializedByCardIdRef.current.get(cardId);

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
		[cardId, delayMs, flushSave],
	);

	useEffect(() => {
		initialContentRef.current = initialContent;

		if (initialVersion !== undefined && initialVersion !== null) {
			const seededVersion = persistedVersionByCardIdRef.current.get(cardId);
			const hasPendingSaveForCard = pendingSaveRef.current?.cardId === cardId;
			if (seededVersion === initialVersion || hasPendingSaveForCard) {
				return;
			}

			persistedVersionByCardIdRef.current.set(cardId, initialVersion);
			persistedSerializedByCardIdRef.current.set(
				cardId,
				serializeContent(initialContentRef.current),
			);
			return;
		}

		persistedSerializedByCardIdRef.current.set(
			cardId,
			serializeContent(initialContentRef.current),
		);
	}, [cardId, initialContent, initialVersion]);

	useEffect(() => {
		return () => {
			if (pendingSaveRef.current?.cardId === cardId) {
				flushSave();
			}
		};
	}, [cardId, flushSave]);

	return { scheduleSave, flushSave };
}
