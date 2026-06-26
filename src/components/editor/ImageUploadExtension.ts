import { Extension } from "@tiptap/core";

export type ImageUploadHandler = (file: File) => Promise<string>;

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		imageUpload: {
			/** Open a native file picker, upload the chosen image, and insert it. */
			uploadImageFromPicker: () => ReturnType;
		};
	}
}

type ImageUploadStorage = {
	onImageUpload: ImageUploadHandler;
};

/**
 * Opens a transient `<input type="file">`, resolving with the selected file or
 * `null` if the picker is dismissed. The element is always removed afterwards.
 */
function pickImageFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.style.display = "none";

		const cleanup = () => {
			input.remove();
		};

		input.addEventListener("change", () => {
			const file = input.files?.[0] ?? null;
			cleanup();
			resolve(file);
		});
		// Fired when the dialog is dismissed without a selection.
		input.addEventListener("cancel", () => {
			cleanup();
			resolve(null);
		});

		document.body.appendChild(input);
		input.click();
	});
}

/**
 * TipTap extension that wires a Convex (or any) upload handler into the editor.
 * Exposes the `uploadImageFromPicker` command used by the slash menu and stashes
 * the handler in `editor.storage` for any callers that need it directly.
 */
export function createImageUploadExtension(onImageUpload: ImageUploadHandler) {
	return Extension.create<Record<string, never>, ImageUploadStorage>({
		name: "imageUpload",

		addStorage() {
			return { onImageUpload };
		},

		addCommands() {
			return {
				uploadImageFromPicker:
					() =>
					({ editor }) => {
						void pickImageFile().then(async (file) => {
							if (!file) return;
							try {
								const src = await onImageUpload(file);
								editor
									.chain()
									.focus()
									.insertContent({ type: "image", attrs: { src } })
									.run();
							} catch (error) {
								console.error("Image upload failed", error);
							}
						});
						return true;
					},
			};
		},
	});
}
