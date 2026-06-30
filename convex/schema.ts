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
		.index("by_archived_depth_path", ["archivedAt", "depth", "pathKey"])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["archivedAt", "parentWhiteboardId"],
		}),

	cards: defineTable({
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		content: v.any(),
		derivedTitle: v.string(),
		plainText: v.string(),
		preview: v.string(),
		version: v.number(),
		activePlacementCount: v.optional(v.number()),
		archivedAt: v.union(v.number(), v.null()),
		updatedAt: v.number(),
	})
		.index("by_archived_updated", ["archivedAt", "updatedAt"])
		.index("by_archived_title", ["archivedAt", "derivedTitle"])
		.index("by_archived_activePlacementCount_updated", [
			"archivedAt",
			"activePlacementCount",
			"updatedAt",
		])
		.index("by_whiteboard_archived_updated", [
			"whiteboardId",
			"archivedAt",
			"updatedAt",
		])
		.searchIndex("search_text", {
			searchField: "plainText",
			filterFields: ["archivedAt", "activePlacementCount"],
		}),

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

	tldrawDocuments: defineTable({
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		snapshot: v.any(),
		version: v.number(),
		revision: v.number(),
		updatedAt: v.number(),
	}).index("by_whiteboard", ["whiteboardId"]),

	files: defineTable({
		storageId: v.id("_storage"),
		url: v.string(),
		kind: v.literal("image"),
		status: v.union(
			v.literal("active"),
			v.literal("pending_delete"),
			v.literal("deleted"),
		),
		refCount: v.number(),
		contentType: v.optional(v.string()),
		size: v.optional(v.number()),
		sha256: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		pendingDeleteAt: v.optional(v.union(v.number(), v.null())),
		deletedAt: v.optional(v.union(v.number(), v.null())),
	})
		.index("by_storageId", ["storageId"])
		.index("by_status_pendingDeleteAt", ["status", "pendingDeleteAt"])
		.index("by_url", ["url"]),

	fileReferences: defineTable({
		fileId: v.id("files"),
		targetKey: v.string(),
		targetType: v.union(v.literal("card"), v.literal("tldrawDocument")),
		createdAt: v.number(),
	})
		.index("by_targetKey", ["targetKey"])
		.index("by_fileId_targetKey", ["fileId", "targetKey"])
		.index("by_fileId", ["fileId"]),

	cardReferences: defineTable({
		sourceCardId: v.id("cards"),
		targetCardId: v.id("cards"),
		updatedAt: v.number(),
	})
		.index("by_sourceCardId", ["sourceCardId"])
		.index("by_targetCardId", ["targetCardId"]),

	todos: defineTable({
		text: v.string(),
		completed: v.boolean(),
	}),
});
