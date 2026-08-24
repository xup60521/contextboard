import { isExternalHref, toSafeHref } from "./href";

export type ExternalLinkOpener = (href: string) => void;

const openInBrowserTab: ExternalLinkOpener = (href) => {
	window.open(href, "_blank", "noopener,noreferrer");
};

let openExternal = openInBrowserTab;

/**
 * Lets a platform shell take over link opening — the desktop app hands hrefs to
 * the OS browser instead of navigating its own webview. Pass `null` to restore
 * the browser-tab default.
 */
export function setExternalLinkOpener(opener: ExternalLinkOpener | null): void {
	openExternal = opener ?? openInBrowserTab;
}

/**
 * Opens an external href through the configured opener. Returns whether the
 * href was ours to handle, so click handlers know when to swallow the event.
 */
export function openExternalLink(href: unknown): boolean {
	const safe = toSafeHref(href);
	if (!safe || !isExternalHref(safe)) return false;

	openExternal(safe);
	return true;
}
