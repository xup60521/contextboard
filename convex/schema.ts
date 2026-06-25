import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	whiteboards: defineTable({
		title: v.string(),
		parentWhiteboardId: v.optional(v.union(v.id("whiteboards"), v.null())),
		ancestorIds: v.optional(v.array(v.id("whiteboards"))),
		depth: v.optional(v.number()),
		sortKey: v.optional(v.string()),
		pathKey: v.optional(v.string()),
		cardCount: v.optional(v.number()),
		childWhiteboardCount: v.optional(v.number()),
		archivedAt: v.optional(v.union(v.number(), v.null())),
		updatedAt: v.optional(v.number()),
		parentId: v.optional(v.string()),
		snapshot: v.optional(v.any()),
	})
		.index("by_parent_archived_sort", [
			"parentWhiteboardId",
			"archivedAt",
			"sortKey",
		])
		.index("by_archived_path", ["archivedAt", "pathKey"])
		.index("by_archived_depth_path", ["archivedAt", "depth", "pathKey"]),

	cards: defineTable({
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		content: v.any(),
		derivedTitle: v.string(),
		plainText: v.string(),
		preview: v.string(),
		version: v.number(),
		archivedAt: v.union(v.number(), v.null()),
		updatedAt: v.number(),
	}).index("by_whiteboard_archived_updated", [
		"whiteboardId",
		"archivedAt",
		"updatedAt",
	]),

	boardItems: defineTable({
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		kind: v.union(v.literal("card"), v.literal("subwhiteboard")),
		cardId: v.union(v.id("cards"), v.null()),
		childWhiteboardId: v.union(v.id("whiteboards"), v.null()),
		shapeId: v.string(),
		x: v.number(),
		y: v.number(),
		w: v.number(),
		h: v.number(),
		rotation: v.number(),
		zIndex: v.number(),
		archivedAt: v.union(v.number(), v.null()),
		updatedAt: v.number(),
	})
		.index("by_whiteboard_archived_z", [
			"whiteboardId",
			"archivedAt",
			"zIndex",
		])
		.index("by_whiteboard_shape", ["whiteboardId", "shapeId"])
		.index("by_card", ["cardId"])
		.index("by_childWhiteboard", ["childWhiteboardId"]),

	todos: defineTable({
		text: v.string(),
		completed: v.boolean(),
	}),
});
