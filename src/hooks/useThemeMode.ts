import { useEffect, useState } from "react";
import { getThemeMode, subscribeThemeMode, type ThemeMode } from "../lib/theme";

/**
 * Returns the live theme mode (`'light' | 'dark' | 'auto'`). Starts at `'auto'`
 * to keep SSR/first paint stable, then syncs to the persisted value and any
 * later changes (in-app, cross-tab, or system).
 */
export function useThemeMode(): ThemeMode {
	const [mode, setMode] = useState<ThemeMode>("auto");

	useEffect(() => {
		setMode(getThemeMode());
		return subscribeThemeMode(() => setMode(getThemeMode()));
	}, []);

	return mode;
}
