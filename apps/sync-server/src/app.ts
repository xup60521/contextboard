import type { ContextboardAuth } from "@contextboard/auth";
import {
	type BlobDescriptor,
	parseBlobHash,
	parseBlobRequestHeaders,
	parseCheckpointDescriptor,
	parseClaimWorkspaceRequest,
	parsePullChangesRequest,
	parsePushChangesRequest,
	parseSyncVersionHeaders,
	parseWorkspaceId,
	SyncProtocolError,
} from "@contextboard/sync-protocol";
import { Hono } from "hono";
import {
	requireSession,
	requireWorkspaceSession,
	SessionAccessError,
} from "./session";
import {
	SequenceConflictError,
	type SyncStore,
	WorkspaceClaimConflictError,
} from "./store";

const POPUP_COMPLETE_PATH = "/api/auth/popup-complete";

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

export function createSyncApp(store: SyncStore, auth?: ContextboardAuth) {
	const app = new Hono();

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

	app.on(["POST", "GET"], "/api/auth/*", (context) =>
		auth
			? auth.handler(context.req.raw)
			: context.json({ error: "Auth is unavailable" }, 503),
	);

	app.get("/api/sync/v1/health", (context) => context.json({ ok: true }));

	app.use("/api/sync/v1/*", async (context, next) => {
		parseSyncVersionHeaders(context.req.raw.headers);
		await next();
	});

	app.get("/api/sync/v1/workspaces", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const session = await requireSession(auth, context.req.raw);
		return context.json({ workspaces: store.listWorkspaces(session.user.id) });
	});

	app.post("/api/sync/v1/workspaces/claim", async (context) => {
		if (!auth) return context.json({ error: "Auth is unavailable" }, 503);
		const input = parseClaimWorkspaceRequest(await context.req.json());
		const session = await requireSession(auth, context.req.raw);
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
			);
		const descriptor: BlobDescriptor = {
			hash,
			contentType: headers.contentType,
			size: headers.size,
		};
		await store.putBlob(
			headers.workspaceId,
			descriptor,
			context.req.raw.body,
		);
		return context.body(null, 204);
	});

	app.get("/api/sync/v1/blobs/:hash", async (context) => {
		const workspaceId = parseWorkspaceId(
			context.req.header("x-contextboard-workspace"),
		);
		if (auth)
			await requireWorkspaceSession(auth, store, context.req.raw, workspaceId);
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
			);
		store.addCheckpoint(input);
		return context.body(null, 204);
	});

	app.get("/api/sync/v1/checkpoints/latest", async (context) => {
		const workspaceId = parseWorkspaceId(context.req.query("workspaceId"));
		if (auth)
			await requireWorkspaceSession(auth, store, context.req.raw, workspaceId);
		const checkpoint = store.latestCheckpoint(workspaceId);
		return checkpoint ? context.json(checkpoint) : context.body(null, 204);
	});

	app.notFound((context) => context.json({ error: "Not found" }, 404));

	app.onError((error, context) => {
		if (error instanceof SessionAccessError)
			return context.json({ error: error.message }, error.status);
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
