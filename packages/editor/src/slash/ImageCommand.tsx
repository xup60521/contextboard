import type { Editor } from "@tiptap/core";
import { useCallback, useRef, useState } from "react";
import { imageInputPluginKey } from "../ImageInputExtension";

type ImageCommandProps = {
	editor: Editor;
};

export function ImageCommand({ editor }: ImageCommandProps) {
	const [url, setUrl] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const insertImage = useCallback(() => {
		const trimmed = url.trim();
		if (!trimmed) return;

		setIsLoading(true);
		setError(null);

		const img = new Image();
		img.onload = () => {
			const state = imageInputPluginKey.getState(editor.state);
			const pos = state?.pos;

			if (pos !== null && pos !== undefined) {
				const { tr } = editor.state;
				const safePos = Math.min(pos, tr.doc.content.size);
				tr.delete(safePos, safePos);
				editor
					.chain()
					.focus()
					.command(({ tr: t, commands }) => {
						const insertPos = Math.min(safePos, t.doc.content.size);
						return commands.insertContentAt(insertPos, {
							type: "image",
							attrs: { src: trimmed },
						});
					})
					.setMeta(imageInputPluginKey, { pos: null })
					.run();
			}

			setUrl("");
			setIsLoading(false);
		};

		img.onerror = () => {
			setError("Invalid image URL");
			setIsLoading(false);
		};

		img.src = trimmed;
	}, [url, editor]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				insertImage();
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setUrl("");
				editor
					.chain()
					.focus()
					.setMeta(imageInputPluginKey, { pos: null })
					.run();
			}
		},
		[insertImage, editor],
	);

	return (
		<div className="image-command-input my-2 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
			<input
				ref={inputRef}
				type="text"
				value={url}
				onChange={(e) => {
					setUrl(e.target.value);
					setError(null);
				}}
				onKeyDown={handleKeyDown}
				placeholder="Paste image URL and press Enter..."
				className="flex-1 bg-transparent text-sm text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]"
				disabled={isLoading}
				// biome-ignore lint/a11y/noAutofocus: input should be focused when image command is triggered
				autoFocus
			/>
			{isLoading && (
				<span className="size-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--lagoon)]" />
			)}
			{error && <span className="text-xs text-red-500">{error}</span>}
		</div>
	);
}
