import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { reconcileTldrawFileRefs } from "./fileLifecycle";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MAX_TLDRAW_DOCUMENT_BYTES = 2_000_000;

export const get = query({
	args: {
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
	},
	handler: async (ctx, args) => {
		if (args.whiteboardId !== null) {
			const whiteboard = await ctx.db.get(args.whiteboardId);
			if (!isActiveWhiteboard(whiteboard)) return null;
		}

		return await getDocumentByWhiteboardId(ctx, args.whiteboardId);
	},
});

export const save = mutation({
	args: {
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		snapshot: v.any(),
		expectedRevision: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const whiteboard =
			args.whiteboardId !== null
				? await getActiveWhiteboard(ctx, args.whiteboardId)
				: null;
		const nextSnapshot = await reconcileTldrawFileRefs(
			ctx,
			args.whiteboardId,
			args.snapshot,
		);
		assertSnapshotSize(nextSnapshot);

		const existingDocument = await getDocumentByWhiteboardId(
			ctx,
			args.whiteboardId,
		);
		if (
			existingDocument &&
			args.expectedRevision !== undefined &&
			args.expectedRevision !== existingDocument.revision
		) {
			throw new Error("Tldraw document was updated elsewhere");
		}

		const now = Date.now();
		const revision = existingDocument ? existingDocument.revision + 1 : 1;

		if (existingDocument) {
			await ctx.db.patch(existingDocument._id, {
				snapshot: nextSnapshot,
				revision,
				updatedAt: now,
			});
		} else {
			await ctx.db.insert("tldrawDocuments", {
				whiteboardId: args.whiteboardId,
				snapshot: nextSnapshot,
				version: 1,
				revision,
				updatedAt: now,
			});
		}

		if (whiteboard) {
			await ctx.db.patch(whiteboard._id, { updatedAt: now });
		}

		return { revision, updatedAt: now };
	},
});

async function getDocumentByWhiteboardId(
	ctx: QueryCtx | MutationCtx,
	whiteboardId: Id<"whiteboards"> | null,
) {
	return await ctx.db
		.query("tldrawDocuments")
		.withIndex("by_whiteboard", (q) => q.eq("whiteboardId", whiteboardId))
		.first();
}

async function getActiveWhiteboard(
	ctx: MutationCtx,
	whiteboardId: Id<"whiteboards">,
) {
	const whiteboard = await ctx.db.get(whiteboardId);
	if (!isActiveWhiteboard(whiteboard)) {
		throw new Error("Whiteboard not found");
	}
	return whiteboard;
}

function isActiveWhiteboard(
	whiteboard: Doc<"whiteboards"> | null,
): whiteboard is Doc<"whiteboards"> {
	return !!whiteboard && whiteboard.archivedAt === null;
}

function assertSnapshotSize(snapshot: unknown) {
	const serialized = JSON.stringify(snapshot);
	if (serialized.length > MAX_TLDRAW_DOCUMENT_BYTES) {
		throw new Error("Tldraw document is too large");
	}
}
