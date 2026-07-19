import { useMutation } from "#/integrations/local/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "#/integrations/local/api";
import type { Id } from "#/integrations/local/types";

export function EditableWhiteboardTitle({
	whiteboardId,
	title,
}: {
	whiteboardId: Id<"whiteboards">;
	title: string;
}) {
	const updateTitle = useMutation(api.whiteboards.updateTitle);
	const inputRef = useRef<HTMLInputElement>(null);
	const isFocusedRef = useRef(false);
	const skipNextBlurSaveRef = useRef(false);
	const [draftTitle, setDraftTitle] = useState(title);

	useEffect(() => {
		if (isFocusedRef.current) return;
		setDraftTitle(title);
	}, [title]);

	const saveTitle = useCallback(() => {
		const nextTitle =
			draftTitle.replace(/\s+/g, " ").trim() || "Untitled whiteboard";
		setDraftTitle(nextTitle);

		if (nextTitle !== title) {
			void updateTitle({ whiteboardId, title: nextTitle });
		}
	}, [draftTitle, title, updateTitle, whiteboardId]);

	return (
		<span className="relative inline-block min-w-0 max-w-[min(42vw,28rem)] align-middle">
			<span
				aria-hidden
				className="invisible block truncate whitespace-pre border border-transparent px-1 py-0.5 font-semibold"
			>
				{draftTitle || " "}
			</span>
			<input
				ref={inputRef}
				className="absolute inset-0 h-full w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-[var(--card-foreground)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--background)]"
				value={draftTitle}
				aria-label="Whiteboard name"
				spellCheck
				onFocus={() => {
					isFocusedRef.current = true;
				}}
				onChange={(event) => setDraftTitle(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						inputRef.current?.blur();
					}

					if (event.key === "Escape") {
						event.preventDefault();
						skipNextBlurSaveRef.current = true;
						setDraftTitle(title);
						inputRef.current?.blur();
					}
				}}
				onBlur={() => {
					isFocusedRef.current = false;
					if (skipNextBlurSaveRef.current) {
						skipNextBlurSaveRef.current = false;
						return;
					}
					saveTitle();
				}}
			/>
		</span>
	);
}
