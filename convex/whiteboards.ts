import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const PATH_UPPER_BOUND_SUFFIX = "\uffff";
const FALLBACK_WHITEBOARD_TITLE = "Untitled whiteboard";
const MAX_WHITEBOARD_TITLE_LENGTH = 120;

export const get = query({
	args: { whiteboardId: v.id("whiteboards") },
	handler: async (ctx, args) => {
		const whiteboard = await ctx.db.get(args.whiteboardId);
		return isActiveWhiteboard(whiteboard) ? whiteboard : null;
	},
});

export const getBreadcrumbs = query({
	args: { whiteboardId: v.id("whiteboards") },
	handler: async (ctx, args) => {
		const whiteboard = await ctx.db.get(args.whiteboardId);
		if (!isActiveWhiteboard(whiteboard)) return [];

		const breadcrumbs: Doc<"whiteboards">[] = [];
		for (const ancestorId of whiteboard.ancestorIds ?? []) {
			const ancestor = await ctx.db.get(ancestorId);
			if (isActiveWhiteboard(ancestor)) {
				breadcrumbs.push(ancestor);
			}
		}

		breadcrumbs.push(whiteboard);
		return breadcrumbs;
	},
});

export const listChildren = query({
	args: {
		parentWhiteboardId: v.union(v.id("whiteboards"), v.null()),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("whiteboards")
			.withIndex("by_parent_archived_sort", (q) =>
				q
					.eq("parentWhiteboardId", args.parentWhiteboardId)
					.eq("archivedAt", null),
			)
			.paginate(args.paginationOpts);
	},
});

export const listSubtree = query({
	args: {
		whiteboardId: v.id("whiteboards"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const whiteboard = await ctx.db.get(args.whiteboardId);
		if (!isActiveWhiteboard(whiteboard) || !whiteboard.pathKey) {
			return emptyPage(args.paginationOpts.cursor);
		}

		const lowerBound = `${whiteboard.pathKey}/`;
		const upperBound = `${lowerBound}${PATH_UPPER_BOUND_SUFFIX}`;
		const whiteboardDepth = whiteboard.depth ?? 0;
		const results = await ctx.db
			.query("whiteboards")
			.withIndex("by_archived_path", (q) =>
				q
					.eq("archivedAt", null)
					.gte("pathKey", lowerBound)
					.lt("pathKey", upperBound),
			)
			.paginate(args.paginationOpts);

		return {
			...results,
			page: results.page.map((descendant) => ({
				...descendant,
				relativeDepth: (descendant.depth ?? 0) - whiteboardDepth,
			})),
		};
	},
});

export const listByDepth = query({
	args: {
		depth: v.number(),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("whiteboards")
			.withIndex("by_archived_depth_path", (q) =>
				q.eq("archivedAt", null).eq("depth", args.depth),
			)
			.paginate(args.paginationOpts);
	},
});

export const updateTitle = mutation({
	args: {
		whiteboardId: v.id("whiteboards"),
		title: v.string(),
	},
	handler: async (ctx, args) => {
		const whiteboard = await ctx.db.get(args.whiteboardId);
		if (!isActiveWhiteboard(whiteboard)) {
			throw new Error("Whiteboard not found");
		}

		const title =
			normalizeTitle(args.title).slice(0, MAX_WHITEBOARD_TITLE_LENGTH) ||
			FALLBACK_WHITEBOARD_TITLE;

		await ctx.db.patch(whiteboard._id, {
			title,
			updatedAt: Date.now(),
		});

		return title;
	},
});

function emptyPage(cursor: string | null) {
	return {
		page: [],
		isDone: true,
		continueCursor: cursor ?? "",
	};
}

function isActiveWhiteboard(
	whiteboard: Doc<"whiteboards"> | null,
): whiteboard is Doc<"whiteboards"> {
	return !!whiteboard && whiteboard.archivedAt === null;
}

function normalizeTitle(value: string) {
	return value.replace(/\s+/g, " ").trim();
}
