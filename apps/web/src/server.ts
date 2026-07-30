type FetchHandler = (
	request: Request,
	env: unknown,
	ctx: unknown,
) => Response | Promise<Response>;

let cachedFetch: FetchHandler | null = null;

export type WorkerEnv = Env;

const VPC_PLACEHOLDER_ORIGIN = "http://localhost:8788";
const JSON_BODY_LIMIT = 2 * 1024 * 1024;
const BLOB_BODY_LIMIT = 512 * 1024 * 1024;
const API_TIMEOUT_MS = 15_000;
const BLOB_TIMEOUT_MS = 5 * 60_000;

const FORWARDED_REQUEST_HEADERS = [
	"accept",
	"access-control-request-headers",
	"access-control-request-method",
	"authorization",
	"content-length",
	"content-type",
	"cookie",
	"origin",
	"user-agent",
	"x-contextboard-blob-size",
	"x-contextboard-protocol-version",
	"x-contextboard-schema-version",
	"x-contextboard-workspace",
] as const;

function privateRoute(pathname: string) {
	if (pathname.startsWith("/api/auth/")) return "auth";
	if (pathname.startsWith("/api/sync/v1/blobs/")) return "blob";
	if (pathname.startsWith("/api/sync/")) return "sync";
	return "private";
}

function privateResponse(
	status: number,
	error: string,
	extraHeaders?: HeadersInit,
) {
	return Response.json(
		{ error },
		{
			status,
			headers: {
				"cache-control": "no-store",
				...extraHeaders,
			},
		},
	);
}

function parseDeclaredLength(request: Request, isBlob: boolean) {
	const header = isBlob
		? (request.headers.get("x-contextboard-blob-size") ??
			request.headers.get("content-length"))
		: request.headers.get("content-length");
	if (header === null) return null;
	if (!/^(0|[1-9]\d*)$/.test(header)) return Number.NaN;
	return Number(header);
}

function forwardedHeaders(request: Request) {
	const headers = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	headers.set("x-contextboard-gateway", "cloudflare-worker");
	return headers;
}

async function rateLimitKey(request: Request) {
	const credential =
		request.headers.get("authorization") ?? request.headers.get("cookie");
	if (credential) {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(credential),
		);
		return `credential:${Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("")}`;
	}
	return `anonymous:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
}

async function isRateLimited(
	request: Request,
	env: WorkerEnv,
	isBlob: boolean,
) {
	const limiter = isBlob ? env.BLOB_RATE_LIMIT : env.SYNC_RATE_LIMIT;
	if (!limiter) return false;
	const result = await limiter.limit({ key: await rateLimitKey(request) });
	return !result.success;
}

export async function proxyPrivateApi(request: Request, env: WorkerEnv) {
	const directOrigin = env.SYNC_VPS_URL?.replace(/\/+$/, "");
	const vpc = env.SYNC_VPS;
	if (!directOrigin && !vpc) {
		return privateResponse(503, "Sync service is temporarily unavailable", {
			"retry-after": "5",
		});
	}

	const url = new URL(request.url);
	const isBlob = url.pathname.startsWith("/api/sync/v1/blobs/");
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	const maximum = isBlob ? BLOB_BODY_LIMIT : JSON_BODY_LIMIT;
	const declaredLength = parseDeclaredLength(request, isBlob);
	if (
		Number.isNaN(declaredLength) ||
		(declaredLength !== null && declaredLength > maximum)
	) {
		return privateResponse(413, "Request body is too large");
	}
	if (await isRateLimited(request, env, isBlob)) {
		return privateResponse(429, "Too many requests", { "retry-after": "60" });
	}

	let bodyLimitExceeded = false;
	let body: BodyInit | null | undefined;
	if (hasBody && isBlob) {
		let streamedBytes = 0;
		body = request.body?.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					streamedBytes += chunk.byteLength;
					if (streamedBytes > maximum) {
						bodyLimitExceeded = true;
						controller.error(new Error("Request body limit exceeded"));
						return;
					}
					controller.enqueue(chunk);
				},
			}),
		);
	} else if (hasBody) {
		const bytes = await request.arrayBuffer();
		if (bytes.byteLength > maximum) {
			return privateResponse(413, "Request body is too large");
		}
		body = bytes;
	}

	const headers = forwardedHeaders(request);
	if (!isBlob && body instanceof ArrayBuffer) {
		headers.set("content-length", String(body.byteLength));
	}
	const upstreamURL = `${directOrigin ?? VPC_PLACEHOLDER_ORIGIN}${url.pathname}${url.search}`;
	const timeout = AbortSignal.timeout(
		isBlob ? BLOB_TIMEOUT_MS : API_TIMEOUT_MS,
	);
	const signal = AbortSignal.any([request.signal, timeout]);
	const upstreamInit: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers,
		body,
		redirect: "manual",
		signal,
	};
	if (upstreamInit.body) upstreamInit.duplex = "half";
	const upstream = new Request(upstreamURL, upstreamInit);
	const startedAt = Date.now();
	const topology = directOrigin ? "direct" : "vpc";

	try {
		let response: Response;
		if (directOrigin) response = await fetch(upstream);
		else {
			if (!vpc) throw new Error("VPC binding is unavailable");
			response = await vpc.fetch(upstream);
		}
		const responseHeaders = new Headers(response.headers);
		for (const name of [
			"connection",
			"keep-alive",
			"proxy-authenticate",
			"server",
			"trailer",
			"transfer-encoding",
			"upgrade",
			"x-powered-by",
		]) {
			responseHeaders.delete(name);
		}
		responseHeaders.set("cache-control", "no-store");
		console.info(
			JSON.stringify({
				event: "private_gateway_request",
				route: privateRoute(url.pathname),
				topology,
				status: response.status,
				durationMs: Date.now() - startedAt,
			}),
		);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		});
	} catch {
		if (bodyLimitExceeded) {
			return privateResponse(413, "Request body is too large");
		}
		console.error(
			JSON.stringify({
				event: "private_service_unavailable",
				route: privateRoute(url.pathname),
				topology,
				outcome: signal.aborted ? "aborted" : "unavailable",
				durationMs: Date.now() - startedAt,
			}),
		);
		return privateResponse(503, "Sync service is temporarily unavailable", {
			"retry-after": "5",
		});
	}
}

async function getFetchHandler() {
	if (cachedFetch) return cachedFetch;
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
