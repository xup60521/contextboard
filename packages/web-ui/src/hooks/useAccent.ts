import { useEffect, useState } from "react";
import {
	type Accent,
	DEFAULT_ACCENT,
	getAccent,
	subscribeThemeMode,
} from "../lib/theme.ts";

/**
 * Returns the live accent. Starts at the default to keep SSR/first paint
 * stable, then syncs to the persisted value and any later change.
 */
export function useAccent(): Accent {
	const [accent, setAccent] = useState<Accent>(DEFAULT_ACCENT);

	useEffect(() => {
		setAccent(getAccent());
		return subscribeThemeMode(() => setAccent(getAccent()));
	}, []);

	return accent;
}
