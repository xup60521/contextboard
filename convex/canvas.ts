import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { deriveCardMetadata } from "./model/cardMetadata";

const DEFAULT_CARD_WIDTH = 576;
const DEFAULT_CARD_HEIGHT = 160;
const DEFAULT_SUBWHITEBOARD_WIDTH = 240;
const DEFAULT_SUBWHITEBOARD_HEIGHT = 92;
const EMPTY_CARD_CONTENT = {
  content: [
    { attrs: { level: 1 }, type: "heading", content: [{ text: "New card", type: "text" }], },
  ],
  type: "doc",
}
const PATH_UPPER_BOUND_SUFFIX = "\uffff";

export const listItems = query({
	args: {
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const results = await ctx.db
			.query("boardItems")
			.withIndex("by_whiteboard_archived_z", (q) =>
				q.eq("whiteboardId", args.whiteboardId).eq("archivedAt", null),
			)
			.paginate(args.paginationOpts);

		const page = await Promise.all(
			results.page.map(async (item) => {
				if (item.kind === "card" && item.cardId) {
					const card = await ctx.db.get(item.cardId);
					return {
						...item,
						card:
									card && card.archivedAt === null
								? {
										_id: card._id,
										content: card.content,
										derivedTitle: card.derivedTitle,
										preview: card.preview,
										version: card.version,
									}
								: null,
						childWhiteboard: null,
					};
				}

				if (item.kind === "subwhiteboard" && item.childWhiteboardId) {
					const childWhiteboard = await ctx.db.get(item.childWhiteboardId);
					return {
						...item,
						card: null,
						childWhiteboard:
							childWhiteboard && childWhiteboard.archivedAt === null
								? {
										_id: childWhiteboard._id,
										title: childWhiteboard.title,
										depth: childWhiteboard.depth ?? 0,
										cardCount: childWhiteboard.cardCount ?? 0,
										childWhiteboardCount:
											childWhiteboard.childWhiteboardCount ?? 0,
									}
								: null,
					};
				}

				return {
					...item,
					card: null,
					childWhiteboard: null,
				};
			}),
		);

		return { ...results, page };
	},
});

export const createCardItem = mutation({
	args: {
		whiteboardId: v.id("whiteboards"),
		shapeId: v.string(),
		x: v.number(),
		y: v.number(),
	},
	handler: async (ctx, args) => {
		const whiteboard = await getActiveWhiteboard(ctx, args.whiteboardId);
		const existingItem = await getExistingItem(
			ctx,
			args.whiteboardId,
			args.shapeId,
		);

		if (existingItem && existingItem.archivedAt === null) {
			return existingItem._id;
		}

		const now = Date.now();
		const metadata = deriveCardMetadata(EMPTY_CARD_CONTENT);
		const cardId = await ctx.db.insert("cards", {
			whiteboardId: whiteboard._id,
			content: EMPTY_CARD_CONTENT,
			derivedTitle: metadata.derivedTitle,
			plainText: metadata.plainText,
			preview: metadata.preview,
			version: 1,
			archivedAt: null,
			updatedAt: now,
		});
		const itemId = await ctx.db.insert("boardItems", {
			whiteboardId: whiteboard._id,
			kind: "card",
			cardId,
			childWhiteboardId: null,
			shapeId: args.shapeId,
			x: args.x,
			y: args.y,
			w: DEFAULT_CARD_WIDTH,
			h: DEFAULT_CARD_HEIGHT,
			rotation: 0,
			zIndex: now,
			archivedAt: null,
			updatedAt: now,
		});

		await ctx.db.patch(whiteboard._id, {
			cardCount: (whiteboard.cardCount ?? 0) + 1,
			updatedAt: now,
		});

		return itemId;
	},
});

export const createSubwhiteboardItem = mutation({
	args: {
		parentWhiteboardId: v.union(v.id("whiteboards"), v.null()),
		shapeId: v.string(),
		x: v.number(),
		y: v.number(),
	},
	handler: async (ctx, args) => {
		const parent = args.parentWhiteboardId
			? await getActiveWhiteboard(ctx, args.parentWhiteboardId)
			: null;
		const existingItem = await getExistingItem(
			ctx,
			args.parentWhiteboardId,
			args.shapeId,
		);

		if (existingItem && existingItem.archivedAt === null) {
			return existingItem._id;
		}

		const now = Date.now();
		const sortKey = makeChildSortKey(parent, now, args.shapeId);
		const pathKey = parent?.pathKey ? `${parent.pathKey}/${sortKey}` : sortKey;
		const childWhiteboardId = await ctx.db.insert("whiteboards", {
			title: parent ? "Sub-whiteboard" : "Whiteboard",
			parentWhiteboardId: parent?._id ?? null,
			ancestorIds: parent ? [...(parent.ancestorIds ?? []), parent._id] : [],
			depth: parent ? (parent.depth ?? 0) + 1 : 0,
			sortKey,
			pathKey,
			cardCount: 0,
			childWhiteboardCount: 0,
			archivedAt: null,
			updatedAt: now,
		});

		const itemId = await ctx.db.insert("boardItems", {
			whiteboardId: parent?._id ?? null,
			kind: "subwhiteboard",
			cardId: null,
			childWhiteboardId,
			shapeId: args.shapeId,
			x: args.x,
			y: args.y,
			w: DEFAULT_SUBWHITEBOARD_WIDTH,
			h: DEFAULT_SUBWHITEBOARD_HEIGHT,
			rotation: 0,
			zIndex: now,
			archivedAt: null,
			updatedAt: now,
		});

		if (parent) {
			await ctx.db.patch(parent._id, {
				childWhiteboardCount: (parent.childWhiteboardCount ?? 0) + 1,
				updatedAt: now,
			});
		}

		return itemId;
	},
});

export const updateItemFrame = mutation({
	args: {
		itemId: v.id("boardItems"),
		x: v.number(),
		y: v.number(),
		w: v.number(),
		h: v.number(),
		rotation: v.number(),
		zIndex: v.number(),
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item || item.archivedAt !== null) {
			throw new Error("Board item not found");
		}

		await ctx.db.patch(item._id, {
			x: args.x,
			y: args.y,
			w: args.w,
			h: args.h,
			rotation: args.rotation,
			zIndex: args.zIndex,
			updatedAt: Date.now(),
		});
	},
});

export const archiveItem = mutation({
	args: {
		itemId: v.id("boardItems"),
		deleteCards: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item || item.archivedAt !== null) return;

		const now = Date.now();
		await ctx.db.patch(item._id, {
			archivedAt: now,
			updatedAt: now,
		});

		const parent = item.whiteboardId ? await ctx.db.get(item.whiteboardId) : null;
		if (item.kind === "card" && item.cardId) {
			await archiveCard(ctx, item.cardId, now);
			if (parent) {
				await ctx.db.patch(parent._id, {
					cardCount: Math.max(0, (parent.cardCount ?? 0) - 1),
					updatedAt: now,
				});
			}
			return;
		}

		if (item.kind === "subwhiteboard" && item.childWhiteboardId) {
			const childWhiteboard = await ctx.db.get(item.childWhiteboardId);
			if (childWhiteboard) {
				await archiveWhiteboardTree(ctx, childWhiteboard, {
					archivedAt: now,
					deleteCards: args.deleteCards ?? false,
				});
			}
			if (parent) {
				await ctx.db.patch(parent._id, {
					childWhiteboardCount: Math.max(
						0,
						(parent.childWhiteboardCount ?? 0) - 1,
					),
					updatedAt: now,
				});
			}
		}
	},
});

export const restoreItem = mutation({
	args: {
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		shapeId: v.string(),
	},
	handler: async (ctx, args) => {
		const item = await getExistingItem(ctx, args.whiteboardId, args.shapeId);
		if (!item || item.archivedAt === null) return null; // nothing archived to restore
		if (item.kind !== "card" || !item.cardId) return null; // cards only (scope decision)

		// Refuse to restore onto an archived/missing board.
		const parent = args.whiteboardId
			? await ctx.db.get(args.whiteboardId)
			: null;
		if (args.whiteboardId && (!parent || parent.archivedAt !== null)) {
			return null;
		}

		const now = Date.now();
		await ctx.db.patch(item._id, { archivedAt: null, updatedAt: now });

		const card = await ctx.db.get(item.cardId);
		if (card && card.archivedAt !== null) {
			await ctx.db.patch(card._id, {
				archivedAt: null,
				whiteboardId: item.whiteboardId, // re-home in case it was orphaned
				updatedAt: now,
			});
		}
		if (parent) {
			await ctx.db.patch(parent._id, {
				cardCount: (parent.cardCount ?? 0) + 1, // symmetric with archiveItem's decrement
				updatedAt: now,
			});
		}
		return item._id;
	},
});

async function getExistingItem(
	ctx: MutationCtx,
	whiteboardId: Id<"whiteboards"> | null,
	shapeId: string,
) {
	return await ctx.db
		.query("boardItems")
		.withIndex("by_whiteboard_shape", (q) =>
			q.eq("whiteboardId", whiteboardId).eq("shapeId", shapeId),
		)
		.first();
}

async function getActiveWhiteboard(
	ctx: MutationCtx,
	whiteboardId: Id<"whiteboards">,
) {
	const whiteboard = await ctx.db.get(whiteboardId);
	if (!whiteboard || whiteboard.archivedAt !== null) {
		throw new Error("Whiteboard not found");
	}
	return whiteboard;
}

function makeChildSortKey(
	parent: Doc<"whiteboards"> | null,
	now: number,
	shapeId: string,
) {
	const ordinal = String(parent?.childWhiteboardCount ?? 0).padStart(10, "0");
	return `${ordinal}-${now.toString(36)}-${shapeId.replace(/^shape:/, "")}`;
}

async function archiveCard(
	ctx: MutationCtx,
	cardId: Id<"cards">,
	archivedAt: number,
) {
	const card = await ctx.db.get(cardId);
	if (!card || card.archivedAt !== null) return;

	await ctx.db.patch(card._id, {
		archivedAt,
		updatedAt: archivedAt,
	});
}

async function orphanCard(
	ctx: MutationCtx,
	cardId: Id<"cards">,
	updatedAt: number,
) {
	const card = await ctx.db.get(cardId);
	if (!card || card.archivedAt !== null) return;

	await ctx.db.patch(card._id, {
		whiteboardId: null,
		updatedAt,
	});
}

async function archiveWhiteboardTree(
	ctx: MutationCtx,
	whiteboard: Doc<"whiteboards">,
	options: { archivedAt: number; deleteCards: boolean },
) {
	if (whiteboard.archivedAt === null) {
		await ctx.db.patch(whiteboard._id, {
			archivedAt: options.archivedAt,
			updatedAt: options.archivedAt,
		});
	}

	await archiveWhiteboardContents(ctx, whiteboard._id, options);

	if (!whiteboard.pathKey) return;

	const lowerBound = `${whiteboard.pathKey}/`;
	const upperBound = `${lowerBound}${PATH_UPPER_BOUND_SUFFIX}`;
	for await (const descendant of ctx.db
		.query("whiteboards")
		.withIndex("by_archived_path", (q) =>
			q
				.eq("archivedAt", null)
				.gte("pathKey", lowerBound)
				.lt("pathKey", upperBound),
		)) {
		await ctx.db.patch(descendant._id, {
			archivedAt: options.archivedAt,
			updatedAt: options.archivedAt,
		});
		await archiveWhiteboardContents(ctx, descendant._id, options);
	}
}

async function archiveWhiteboardContents(
	ctx: MutationCtx,
	whiteboardId: Id<"whiteboards">,
	options: { archivedAt: number; deleteCards: boolean },
) {
	for await (const item of ctx.db
		.query("boardItems")
		.withIndex("by_whiteboard_archived_z", (q) =>
			q.eq("whiteboardId", whiteboardId).eq("archivedAt", null),
		)) {
		await ctx.db.patch(item._id, {
			archivedAt: options.archivedAt,
			updatedAt: options.archivedAt,
		});

		if (item.kind === "card" && item.cardId) {
			if (options.deleteCards) {
				await archiveCard(ctx, item.cardId, options.archivedAt);
			} else {
				await orphanCard(ctx, item.cardId, options.archivedAt);
			}
		}
	}
}
