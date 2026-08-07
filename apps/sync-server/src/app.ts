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
	DeviceFlowError,
	formatUserCode,
	normalizeUserCode,
} from "./device-codes";
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
const DEVICE_PATH = "/api/sync/v1/device";
const UNVERSIONED_PATHS = [AGENT_TOKENS_PATH, DEVICE_PATH];

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
	publicAppUrl?: string;
};

export function createSyncApp(
	store: SyncStore,
	auth?: ContextboardAuth,
	options?: SyncAppOptions,
) {
	const app = new Hono();

	const allowedOrigins = new Set(options?.crossOriginAllowlist ?? []);
	const allowedEmails = options?.allowedEmails;
	const configuredPublicAppUrl = options?.publicAppUrl
		? new URL(options.publicAppUrl).origin
		: null;
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
		// they are most likely to need it. Device authorization is likewise
		// deliberately unversioned: a first-time-login CLI has no protocol version,
		// and a bump must not lock a user out of obtaining credentials any more than
		// out of revoking them.
		if (
			!UNVERSIONED_PATHS.some((path) =>
				context.req.path.startsWith(path),
			)
		) {
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
		const pulled = store.pull(input.workspaceId, input.cursor, input.limit);
		if (input.capabilities?.includes("card-content-v1"))
			return context.json(pulled);
		return context.json({
			...pulled,
			batches: pulled.batches.map((batch) => ({
				...batch,
				changes: batch.changes.filter(
					(change) => change.entityType !== "cardContent",
				),
			})),
		});
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

	app.post(`${DEVICE_PATH}/code`, async (context) => {
		let body: {
			clientName?: unknown;
			deviceName?: unknown;
		} | null = {};
		if (context.req.raw.body) {
			try {
				body = (await context.req.json()) as typeof body;
			} catch {
				throw new DeviceFlowError(400, {
					error: "invalid_request",
					error_description: "Request body must be valid JSON",
				});
			}
		}
		if (body === null || typeof body !== "object" || Array.isArray(body))
			throw new DeviceFlowError(400, {
				error: "invalid_request",
				error_description: "Request body must be an object",
			});
		const clientName = body?.clientName;
		const deviceName = body?.deviceName;
		if (
			(clientName !== undefined && typeof clientName !== "string") ||
			(deviceName !== undefined && deviceName !== null && typeof deviceName !== "string")
		)
			throw new DeviceFlowError(400, {
				error: "invalid_request",
				error_description: "clientName and deviceName must be strings",
			});

		const created = store.createDeviceCode({
			clientName: clientName ?? "contextboard-cli",
			deviceName: deviceName ?? null,
		});
		const publicOrigin =
			configuredPublicAppUrl ?? new URL(context.req.url).origin;
		const verificationUri = new URL("/device", publicOrigin);
		const verificationUriComplete = new URL(verificationUri);
		verificationUriComplete.searchParams.set(
			"user_code",
			formatUserCode(created.userCode),
		);
		return context.json(
			{
				deviceCode: created.deviceCode,
				userCode: formatUserCode(created.userCode),
				verificationUri: verificationUri.toString(),
				verificationUriComplete: verificationUriComplete.toString(),
				expiresIn: Math.ceil((created.expiresAt - Date.now()) / 1000),
				interval: created.intervalSeconds,
			},
			201,
		);
	});

	app.post(`${DEVICE_PATH}/token`, async (context) => {
		const body = (await context.req.json().catch(() => null)) as {
			deviceCode?: unknown;
		} | null;
		if (!body || typeof body.deviceCode !== "string" || !body.deviceCode)
			throw new DeviceFlowError(400, {
				error: "invalid_request",
				error_description: "deviceCode is required",
			});

		const result = store.pollDeviceCode(body.deviceCode);
		if (result.status === "pending")
			throw new DeviceFlowError(400, {
				error: "authorization_pending",
				error_description: "The user has not approved this device yet",
			});
		if (result.status === "slow_down")
			throw new DeviceFlowError(429, {
				error: "slow_down",
				error_description: "Poll less frequently",
				interval: result.intervalSeconds,
			});
		if (result.status === "denied")
			throw new DeviceFlowError(400, {
				error: "access_denied",
				error_description: "The user denied this device authorization",
			});
		if (result.status === "expired")
			throw new DeviceFlowError(400, {
				error: "expired_token",
				error_description: "The device authorization is no longer valid",
			});

		return context.json({
			token: result.token,
			tokenId: result.tokenId,
			name: result.name,
			serverUrl: configuredPublicAppUrl ?? new URL(context.req.url).origin,
		});
	});

	app.get(`${DEVICE_PATH}/authorization`, async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		await requireUserSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		const rawUserCode = context.req.query("user_code");
		if (!rawUserCode) return context.json({ error: "Not found" }, 404);
		let userCode: string;
		try {
			userCode = normalizeUserCode(rawUserCode);
		} catch {
			return context.json({ error: "Not found" }, 404);
		}
		const found = store.findDeviceCodeByUserCode(userCode);
		if (!found) return context.json({ error: "Not found" }, 404);
		return context.json({
			userCode: formatUserCode(userCode),
			clientName: found.clientName,
			deviceName: found.deviceName,
			expiresAt: found.expiresAt,
			status: found.status,
		});
	});

	app.post(`${DEVICE_PATH}/authorization`, async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const session = await requireUserSession(
			auth,
			store,
			context.req.raw,
			allowedEmails,
		);
		if (!session.user.email)
			return context.json({ error: "Account has no email address" }, 403);
		const body = (await context.req.json().catch(() => null)) as {
			userCode?: unknown;
			action?: unknown;
		} | null;
		if (
			!body ||
			typeof body.userCode !== "string" ||
			(body.action !== "approve" && body.action !== "deny")
		)
			throw new DeviceFlowError(400, {
				error: "invalid_request",
				error_description: "userCode and a valid action are required",
			});
		let userCode: string;
		try {
			userCode = normalizeUserCode(body.userCode);
		} catch {
			throw new DeviceFlowError(400, {
				error: "invalid_request",
				error_description: "userCode is invalid",
			});
		}
		const decided = store.decideDeviceCode(
			userCode,
			session.user.id,
			session.user.email,
			body.action,
		);
		if (!decided) return context.json({ error: "Not found" }, 404);
		return context.body(null, 204);
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
		if (error instanceof DeviceFlowError) {
			if (error.body.error === "slow_down" && error.body.interval !== undefined)
				context.header("retry-after", String(error.body.interval));
			return context.json(error.body, error.status as 400 | 429);
		}
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
