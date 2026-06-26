import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";

export const getTldrawLicenseKey = createServerFn({
	method: "GET",
}).handler(async () => {
	return (
		env.TLDRAW_LICENSE_KEY ??
		env.VITE_TLDRAW_LICENSE_KEY ??
		process.env.TLDRAW_LICENSE_KEY ??
		process.env.VITE_TLDRAW_LICENSE_KEY ??
		null
	);
});
