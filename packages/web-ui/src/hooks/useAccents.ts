import { useEffect, useState } from "react";
import {
	type Accents,
	DEFAULT_ACCENT,
	getAccents,
	subscribeThemeMode,
} from "../lib/theme.ts";

const INITIAL: Accents = { light: DEFAULT_ACCENT, dark: DEFAULT_ACCENT };

/**
 * Returns the live accent for each appearance. Starts at the default to keep
 * SSR/first paint stable, then syncs to the persisted values and any change.
 */
export function useAccents(): Accents {
	const [accents, setAccents] = useState<Accents>(INITIAL);

	useEffect(() => {
		setAccents(getAccents());
		return subscribeThemeMode(() => setAccents(getAccents()));
	}, []);

	return accents;
}
