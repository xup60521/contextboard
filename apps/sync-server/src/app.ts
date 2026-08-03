import type { ContextboardAuth } from "@contextboard/auth";
import {
	type BlobDescriptor,
	parseBlobHash,
	parseBlobRequestHeaders,
	parseCheckpointDescriptor,
	parseClaimWorkspaceRequest,
	parsePullChangesRequest,
	parsePushChangesRequest,
	parseSelectWorkspaceRequest,
	parseSyncVersionHeaders,
	parseWorkspaceId,
	SyncProtocolError,
} from "@contextboard/sync-protocol";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AllowedEmailSet, isAllowedUser } from "./access";
import { AgentTokenError, parseAgentTokenName } from "./agent-tokens";
import {
	requireSession,
	requireUserSession,
	requireWorkspaceSession,
	SessionAccessError,
	WorkspaceRedirectError,
} from "./session";
import {
	SequenceConflictError,
	type SyncStore,
	WorkspaceClaimConflictError,
	WorkspaceMembershipError,
} from "./store";

const POPUP_COMPLETE_PATH = "/api/auth/popup-complete";
/**
 * Lives under the sync prefix because the Cloudflare Worker only proxies
 * `/api/sync/*` and `/api/auth/*`; a top-level path would not reach this server.
 */
const AGENT_TOKENS_PATH = "/api/sync/v1/agent-tokens";

function popupCompleteDocument() {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body>
<p>Completing sign in…</p>
<script>
(() => {
  const error = new URLSearchParams(window.location.search).get("error");
  window.opener?.postMessage({ type: "contextboard:auth-popup-complete", error }, window.location.origin);
  window.close();
})();
</script>
</body>
</html>`;
}

export type SyncAppOptions = {
	/**
	 * Origins allowed to call the API cross-origin. Only the desktop shell needs
	 * this: the Web client is same-origin behind the Cloudflare Worker.
	 */
	crossOriginAllowlist?: string[];
	allowedEmails?: AllowedEmailSet;
};

export function createSyncApp(
	store: SyncStore,
	auth?: ContextboardAuth,
	options?: SyncAppOptions,
) {
	const app = new Hono();

	const allowedOrigins = new Set(options?.crossOriginAllowlist ?? []);
	const allowedEmails = options?.allowedEmails;
	if (allowedOrigins.size) {
		// Desktop authenticates with a bearer token, never a cookie, so
		// credentials stay off and no CSRF surface is opened here.
		const crossOrigin = cors({
			origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
			allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
			allowHeaders: [
				"authorization",
				"content-type",
				"x-contextboard-blob-size",
				"x-contextboard-protocol-version",
				"x-contextboard-schema-version",
				"x-contextboard-workspace",
			],
			exposeHeaders: ["set-auth-token"],
			credentials: false,
			maxAge: 600,
		});
		app.use("/api/auth/*", crossOrigin);
		app.use("/api/sync/v1/*", crossOrigin);
	}

	app.use("*", async (context, next) => {
		await next();
		if (
			context.req.path.startsWith("/api/auth/") ||
			context.res.headers.get("content-type")?.includes("application/json")
		) {
			context.header("cache-control", "no-store");
		}
	});

	// This exact callback is handled before Better Auth's wildcard. It keeps the
	// OAuth flow inside a popup and only notifies the same-origin opener.
	app.get(POPUP_COMPLETE_PATH, (context) =>
		context.html(popupCompleteDocument()),
	);

	app.get("/api/auth/get-session", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const response = await auth.handler(context.req.raw);
		if (!allowedEmails || !response.ok) return response;
		const payload = (await response.clone().json().catch(() => null)) as {
			user?: { email?: string | null; emailVerified?: boolean };
		} | null;
		if (payload?.user && !isAllowedUser(payload.user, allowedEmails))
			return context.json({ error: "Forbidden" }, 403);
		return response;
	});

	app.get("/api/auth/one-time-token/generate", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		if (allowedEmails)
			await requireSession(auth, store, context.req.raw, allowedEmails);
		return auth.handler(context.req.raw);
	});

	app.post("/api/auth/one-time-token/verify", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const response = await auth.handler(context.req.raw);
		if (!allowedEmails || !response.ok) return response;
		const payload = (await response.clone().json().catch(() => null)) as {
			user?: { email?: string | null; emailVerified?: boolean };
		} | null;
		if (payload?.user && !isAllowedUser(payload.user, allowedEmails))
			return context.json({ error: "Forbidden" }, 403);
		return response;
	});

	app.on(["POST", "GET"], "/api/auth/*", (context) =>
		auth
			? auth.handler(context.req.raw)
			: context.json({ error: "Auth is unavailable" }, 503),
	);

	app.get("/api/sync/v1/health", (context) => context.json({ ok: true }));

	app.use("/api/sync/v1/*", async (context, next) => {
		// Agent token management is an account API that merely shares the proxied
		// path prefix. Gating it on the sync protocol version would make a version
		// bump lock the user out of revoking credentials, which is precisely when
		// they are most likely to need it.
		if (!context.req.path.startsWith(AGENT_TOKENS_PATH)) {
			parseSyncVersionHeaders(context.req.raw.headers);
		}
		await next();
	});

	app.get("/api/sync/v1/workspaces", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const session = await requireSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		return context.json(store.listWorkspaces(session.user.id));
	});

	app.post("/api/sync/v1/workspaces/select", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const input = parseSelectWorkspaceRequest(await context.req.json());
		const session = await requireSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		const redirect = store.getWorkspaceRedirect(
			input.workspaceId,
			session.user.id,
		);
		if (redirect) throw new WorkspaceRedirectError(redirect.toWorkspaceId);
		return context.json(
			store.selectDefaultWorkspace(input.workspaceId, session.user.id),
		);
	});

	app.post("/api/sync/v1/workspaces/claim", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const input = parseClaimWorkspaceRequest(await context.req.json());
		const session = await requireSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		return context.json(
			store.claimWorkspace(input.workspaceId, input.deviceId, session.user.id),
		);
	});

	app.post("/api/sync/v1/push", async (context) => {
		const input = parsePushChangesRequest(await context.req.json());
		if (auth)
			await requireWorkspaceSession(
				auth,
				store,
				context.req.raw,
				input.workspaceId,
				allowedEmails,
			);
		return context.json(store.push(input.workspaceId, input.batches));
	});

	app.post("/api/sync/v1/pull", async (context) => {
		const input = parsePullChangesRequest(await context.req.json());
		if (auth)
			await requireWorkspaceSession(
				auth,
				store,
				context.req.raw,
				input.workspaceId,
				allowedEmails,
			);
		return context.json(
			store.pull(input.workspaceId, input.cursor, input.limit),
		);
	});

	app.put("/api/sync/v1/blobs/:hash", async (context) => {
		const headers = parseBlobRequestHeaders(context.req.raw.headers);
		const hash = parseBlobHash(context.req.param("hash"));
		if (!context.req.raw.body)
			return context.json({ error: "Invalid blob request" }, 400);
		if (auth)
			await requireWorkspaceSession(
				auth,
				store,
				context.req.raw,
				headers.workspaceId,
				allowedEmails,
			);
		const descriptor: BlobDescriptor = {
			hash,
			contentType: headers.contentType,
			size: headers.size,
		};
		await store.putBlob(headers.workspaceId, descriptor, context.req.raw.body);
		return context.body(null, 204);
	});

	app.get("/api/sync/v1/blobs/:hash", async (context) => {
		const workspaceId = parseWorkspaceId(
			context.req.header("x-contextboard-workspace"),
		);
		if (auth)
			await requireWorkspaceSession(
				auth,
				store,
				context.req.raw,
				workspaceId,
				allowedEmails,
			);
		const hash = parseBlobHash(context.req.param("hash"));
		const descriptor = store.getBlobDescriptor(workspaceId, hash);
		if (!descriptor) return context.json({ error: "Not found" }, 404);
		const file = Bun.file(store.blobPath(workspaceId, hash));
		if (!(await file.exists()))
			return context.json({ error: "Not found" }, 404);
		return context.body(file.stream(), 200, {
			"content-type": descriptor.contentType,
			"content-length": String(descriptor.size),
			"cache-control": "private, immutable",
		});
	});

	app.post("/api/sync/v1/checkpoints", async (context) => {
		const input = parseCheckpointDescriptor(await context.req.json());
		if (auth)
			await requireWorkspaceSession(
				auth,
				store,
				context.req.raw,
				input.workspaceId,
				allowedEmails,
			);
		store.addCheckpoint(input);
		return context.body(null, 204);
	});

	app.get("/api/sync/v1/checkpoints/latest", async (context) => {
		const workspaceId = parseWorkspaceId(context.req.query("workspaceId"));
		if (auth)
			await requireWorkspaceSession(
				auth,
				store,
				context.req.raw,
				workspaceId,
				allowedEmails,
			);
		const checkpoint = store.latestCheckpoint(workspaceId);
		return checkpoint ? context.json(checkpoint) : context.body(null, 204);
	});

	app.post(AGENT_TOKENS_PATH, async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const session = await requireUserSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		const body = (await context.req.json().catch(() => null)) as {
			name?: unknown;
		} | null;
		const name = parseAgentTokenName(body?.name);
		if (!session.user.email)
			return context.json({ error: "Account has no email address" }, 403);
		const created = store.createAgentToken(
			session.user.id,
			session.user.email,
			name,
		);
		// `token` appears in this response and nowhere else, ever.
		return context.json(created, 201);
	});

	app.get(AGENT_TOKENS_PATH, async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const session = await requireUserSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		return context.json(store.listAgentTokens(session.user.id));
	});

	app.delete(`${AGENT_TOKENS_PATH}/:id`, async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const session = await requireUserSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		const revoked = store.revokeAgentToken(
			session.user.id,
			context.req.param("id"),
		);
		if (!revoked) return context.json({ error: "Not found" }, 404);
		return context.body(null, 204);
	});

	app.notFound((context) => context.json({ error: "Not found" }, 404));

	app.onError((error, context) => {
		if (error instanceof WorkspaceRedirectError)
			return context.json(
				{
					error: error.message,
					redirectWorkspaceId: error.redirectWorkspaceId,
				},
				410,
			);
		if (error instanceof SessionAccessError)
			return context.json({ error: error.message }, error.status);
		if (error instanceof WorkspaceMembershipError)
			return context.json({ error: error.message }, 403);
		if (error instanceof AgentTokenError)
			return context.json({ error: error.message }, 400);
		if (
			error instanceof SequenceConflictError ||
			error instanceof WorkspaceClaimConflictError
		)
			return context.json({ error: error.message }, 409);
		if (error instanceof SyncProtocolError) {
			console.warn(
				JSON.stringify({
					event: "sync_protocol_rejected",
					path: context.req.path,
					message: error.message,
				}),
			);
			return context.json({ error: error.message }, 400);
		}
		console.error(
			JSON.stringify({
				event: "sync_request_failed",
				path: context.req.path,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return context.json(
			{ error: error instanceof Error ? error.message : "Invalid request" },
			400,
		);
	});

	return app;
}
