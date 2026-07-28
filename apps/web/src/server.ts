type FetchHandler = (
	request: Request,
	env: unknown,
	ctx: unknown,
) => Response | Promise<Response>;

let cachedFetch: FetchHandler | null = null;

export type WorkerEnv = {
	SYNC_VPS?: Fetcher;
	SYNC_VPS_URL?: string;
};

const VPC_PLACEHOLDER_ORIGIN = "https://contextboard.internal";

const STRIPPED_HEADERS = new Set([
	"cf-connecting-ip",
	"cf-ipcountry",
	"cf-ray",
	"host",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-real-ip",
]);

export async function proxyPrivateApi(request: Request, env: WorkerEnv) {
	const directOrigin = env.SYNC_VPS_URL?.replace(/\/+$/, "");
	const vpc = env.SYNC_VPS;
	if (!directOrigin && !vpc) {
		return Response.json(
			{ error: "Sync service is temporarily unavailable" },
			{
				status: 503,
				headers: { "retry-after": "5", "cache-control": "no-store" },
			},
		);
	}
	const url = new URL(request.url);
	const contentLength = Number(request.headers.get("content-length") ?? 0);
	const isBlob = url.pathname.startsWith("/api/sync/v1/blobs/");
	const maximum = isBlob ? 512 * 1024 * 1024 : 2 * 1024 * 1024;
	if (!Number.isFinite(contentLength) || contentLength > maximum) {
		return Response.json(
			{ error: "Request body is too large" },
			{ status: 413, headers: { "cache-control": "no-store" } },
		);
	}
	const headers = new Headers(request.headers);
	for (const name of STRIPPED_HEADERS) headers.delete(name);
	headers.set("x-contextboard-gateway", "cloudflare-worker");
	const upstreamURL = `${directOrigin ?? VPC_PLACEHOLDER_ORIGIN}${url.pathname}${url.search}`;
	const upstreamInit: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers,
		body:
			request.method === "GET" || request.method === "HEAD"
				? undefined
				: request.body,
		redirect: "manual",
	};
	if (upstreamInit.body) upstreamInit.duplex = "half";
	const upstream = new Request(upstreamURL, upstreamInit);
	try {
		let response: Response;
		if (directOrigin) response = await fetch(upstream);
		else {
			if (!vpc) throw new Error("VPC binding is unavailable");
			response = await vpc.fetch(upstream);
		}
		const responseHeaders = new Headers(response.headers);
		responseHeaders.delete("server");
		responseHeaders.delete("x-powered-by");
		if (url.pathname.startsWith("/api/auth/")) {
			responseHeaders.set("cache-control", "no-store");
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "private_service_unavailable",
				path: url.pathname,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return Response.json(
			{ error: "Sync service is temporarily unavailable" },
			{
				status: 503,
				headers: { "retry-after": "5", "cache-control": "no-store" },
			},
		);
	}
}

async function getFetchHandler() {
	if (cachedFetch) {
		return cachedFetch;
	}

	const startServer = await import("@tanstack/react-start/server");
	cachedFetch = startServer.createStartHandler(
		startServer.defaultStreamHandler,
	) as FetchHandler;

	return cachedFetch;
}

const hot = (
	import.meta as ImportMeta & {
		hot?: {
			accept: (callback?: () => void) => void;
		};
	}
).hot;

hot?.accept(() => {
	cachedFetch = null;
});

export default {
	async fetch(request: Request, env: WorkerEnv, ctx: unknown) {
		const pathname = new URL(request.url).pathname;
		if (
			pathname.startsWith("/api/sync/") ||
			pathname.startsWith("/api/auth/")
		) {
			return proxyPrivateApi(request, env);
		}
		const fetchHandler = await getFetchHandler();
		return fetchHandler(request, env, ctx);
	},
};
