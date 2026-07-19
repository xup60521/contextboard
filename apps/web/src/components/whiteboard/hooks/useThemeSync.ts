import { useEffect } from "react";
import { react as tldrawReact, type Editor } from "tldraw";
import { getThemeMode, setThemeMode, type ThemeMode } from "../../../lib/theme";
import { colorSchemeToMode, modeToColorScheme } from "../whiteboard-canvas-helpers";

export function useThemeSync({
	editor,
	themeMode,
}: {
	editor: Editor | null;
	themeMode: ThemeMode;
}) {
	// App theme -> tldraw color scheme.
	useEffect(() => {
		if (!editor) return;
		const target = modeToColorScheme(themeMode);
		if (editor.user.getUserPreferences().colorScheme !== target) {
			editor.user.updateUserPreferences({ colorScheme: target });
		}
	}, [editor, themeMode]);

	// tldraw color scheme (e.g. its built-in theme menu) -> app theme, so the
	// custom cards and the rest of the app follow tldraw's own toggle too.
	useEffect(() => {
		if (!editor) return;
		return tldrawReact("sync tldraw color scheme to app theme", () => {
			const nextMode = colorSchemeToMode(
				editor.user.getUserPreferences().colorScheme,
			);
			if (getThemeMode() !== nextMode) {
				setThemeMode(nextMode);
			}
		});
	}, [editor]);
}
