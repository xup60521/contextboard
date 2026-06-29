import type { JSONContent } from "@tiptap/core";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type UseDebouncedCardSaveResult = {
	scheduleSave: (content: JSONContent) => void;
	flushSave: () => void;
};

export function useDebouncedCardSave(
	cardId: Id<"cards">,
	delayMs = 450,
	options?: {
		onPersisted?: (result: {
			content: JSONContent;
			version: number;
		}) => void;
	},
): UseDebouncedCardSaveResult {
	const updateContent = useMutation(api.cards.updateContent);
	const pendingContentRef = useRef<JSONContent | null>(null);
	const saveTimerRef = useRef<number | null>(null);

	const flushSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const content = pendingContentRef.current;
		pendingContentRef.current = null;
		if (!content) return;

		void Promise.resolve(updateContent({ cardId, content })).then((version) => {
			options?.onPersisted?.({ content, version });
		});
	}, [cardId, options, updateContent]);

	const scheduleSave = useCallback(
		(content: JSONContent) => {
			pendingContentRef.current = content;

			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}

			saveTimerRef.current = window.setTimeout(flushSave, delayMs);
		},
		[delayMs, flushSave],
	);

	useEffect(() => {
		return () => {
			flushSave();
		};
	}, [flushSave]);

	return { scheduleSave, flushSave };
}
