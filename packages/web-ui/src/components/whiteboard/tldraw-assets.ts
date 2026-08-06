// The pinned 3.15.6 package exposes its Vite entry as `imports.vite`.
import { getAssetUrlsByImport as getAssetUrls } from "@tldraw/assets/imports.vite";
import { getAssetUrlsByMetaUrl } from "@tldraw/assets/urls";

/**
 * tldraw resolves icons, fonts and translations from its CDN by default. The
 * desktop build runs behind a Tauri CSP with no CDN origins allowed, so the
 * assets are emitted into the bundle and served from the app itself.
 */
export const tldrawAssetUrls = (() => {
	try {
		return getAssetUrls();
	} catch {
		// Bun's test transformer leaves `?url` imports undefined. Vite uses the
		// import path above in real builds; the metadata path keeps non-Vite test
		// consumers from crashing while still resolving to package-local assets.
		return getAssetUrlsByMetaUrl();
	}
})();
