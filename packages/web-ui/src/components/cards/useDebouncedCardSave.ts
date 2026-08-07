import {
	recordContextboardPerf,
	useApplicationRuntime,
} from "@contextboard/application";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	clearCardContentDirty,
	markCardContentDirty,
} from "../whiteboard/dirty-card-content";

type PendingSave = {
	cardId: string;
	content: JSONContent;
	serialized: string;
};

const serialize = (content: JSONContent | null | undefined) =>
	JSON.stringify(content ?? null);

export function useDebouncedCardSave(
	cardId: string,
	delayMs = 450,
	options?: {
		initialContent?: JSONContent | null;
		initialVersion?: number | null;
		onPersisted?: (result: { content: JSONContent; version: number }) => void;
	},
) {
	const runtime = useApplicationRuntime();
	const pendingRef = useRef<PendingSave | null>(null);
	const timerRef = useRef<number | null>(null);
	const persistedByCardRef = useRef(new Map<string, string>());
	const versionByCardRef = useRef(new Map<string, number>());
	const onPersistedRef = useRef(options?.onPersisted);
	const [error, setError] = useState<Error | null>(null);
	onPersistedRef.current = options?.onPersisted;

	const flushSave = useCallback(() => {
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = null;
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (!pending) return;
		if (persistedByCardRef.current.get(pending.cardId) === pending.serialized)
			return;

		void Promise.resolve(
			(recordContextboardPerf("card.content.write", {
				detail: pending.cardId,
			}),
			runtime.cards.updateContent({
				cardId: pending.cardId,
				content: pending.content,
				expectedVersion: versionByCardRef.current.get(pending.cardId),
			})),
		)
			.then((version) => {
				persistedByCardRef.current.set(pending.cardId, pending.serialized);
				if (typeof version === "number")
					versionByCardRef.current.set(pending.cardId, version);
				setError(null);
				if (pendingRef.current?.cardId !== pending.cardId)
					clearCardContentDirty(pending.cardId);
				if (typeof version === "number")
					onPersistedRef.current?.({ content: pending.content, version });
			})
			.catch((reason: unknown) => {
				// Do not overwrite a newer edit queued while this request was in flight.
				if (!pendingRef.current) pendingRef.current = pending;
				setError(reason instanceof Error ? reason : new Error(String(reason)));
			});
	}, [runtime.cards]);

	const scheduleSave = useCallback(
		(content: JSONContent) => {
			const serialized = serialize(content);
			if (persistedByCardRef.current.get(cardId) === serialized) {
				pendingRef.current = null;
				if (timerRef.current !== null) window.clearTimeout(timerRef.current);
				timerRef.current = null;
				clearCardContentDirty(cardId);
				return;
			}
			pendingRef.current = { cardId, content, serialized };
			markCardContentDirty(cardId);
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(flushSave, delayMs);
		},
		[cardId, delayMs, flushSave],
	);

	useEffect(() => {
		const version = options?.initialVersion;
		const hasPending = pendingRef.current?.cardId === cardId;
		if (version !== undefined && version !== null) {
			if (versionByCardRef.current.get(cardId) === version || hasPending) return;
			versionByCardRef.current.set(cardId, version);
		}
		persistedByCardRef.current.set(cardId, serialize(options?.initialContent));
		setError(null);
	}, [cardId, options?.initialContent, options?.initialVersion]);

	useEffect(
		() => () => {
			if (pendingRef.current?.cardId === cardId) flushSave();
		},
		[cardId, flushSave],
	);

	return { scheduleSave, flushSave, error };
}
