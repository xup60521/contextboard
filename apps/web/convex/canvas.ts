import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
	clearCardFileRefs,
	clearTldrawFileRefs,
	reconcileCardFileRefs,
} from "./fileLifecycle";
import {
	clearCardReferences,
	reconcileCardReferences,
} from "./model/cardReferences";
import { deriveCardMetadata } from "./model/cardMetadata";
import {
	decrementActivePlacementCount,
	incrementActivePlacementCount,
	setActivePlacementCount,
} from "./model/cardPlacements";
import { assertValidTldrawShapeId } from "./model/shapeIds";

export const DEFAULT_CARD_WIDTH = 576;
export const DEFAULT_CARD_HEIGHT = 160;
const DEFAULT_SUBWHITEBOARD_WIDTH = 240;
const DEFAULT_SUBWHITEBOARD_HEIGHT = 92;
const EMPTY_CARD_CONTENT = {
  content: [
    { attrs: { level: 1 }, type: "heading", content: [{ text: "New card", type: "text" }], },
  ],
  type: "doc",
}
const MAX_CARD_CONTENT_BYTES = 250_000;
const PATH_UPPER_BOUND_SUFFIX = "\uffff";

// Parse the serialized TipTap content carried on a pasted markdown-card shape.
// Falls back to an empty card for missing, malformed, oversized, or non-doc input.
function parseCardContent(serialized: string | undefined): unknown {
	if (!serialized || serialized.length > MAX_CARD_CONTENT_BYTES) {
		return EMPTY_CARD_CONTENT;
	}
	try {
		const parsed = JSON.parse(serialized);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			(parsed as { type?: unknown }).type === "doc"
		) {
			return parsed;
		}
	} catch {
		// fall through
	}
	return EMPTY_CARD_CONTENT;
}

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
		assertValidTldrawShapeId(args.shapeId);
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
			whiteboardId: null,
			content: EMPTY_CARD_CONTENT,
			derivedTitle: metadata.derivedTitle,
			plainText: metadata.plainText,
			preview: metadata.preview,
			version: 1,
			activePlacementCount: 1,
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
		assertValidTldrawShapeId(args.shapeId);
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
			await decrementActivePlacementCount(ctx, item.cardId);
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

// Handle a newly-added markdown-card shape. tldraw re-adds a shape with its
// original id on undo-of-delete (restore the archived item), but assigns a fresh
// id on paste/duplicate. Pasted Convex-backed cards should become another board
// placement pointing at the same card; stale/local clipboard shapes without a
// valid card id fall back to adopting the carried content into a new card.
export const restoreOrAdoptCardItem = mutation({
	args: {
		whiteboardId: v.union(v.id("whiteboards"), v.null()),
		shapeId: v.string(),
		sourceCardId: v.optional(v.string()),
		content: v.optional(v.string()), // serialized TipTap JSON from shape props
		x: v.number(),
		y: v.number(),
		w: v.number(),
		h: v.number(),
		rotation: v.number(),
	},
	handler: restoreOrAdoptCardItemImpl,
});

// Unarchive an archived card boardItem (and its card), restoring it onto its
// board. Returns null if it isn't a restorable card item or the board is gone.
async function restoreArchivedCardItem(
	ctx: MutationCtx,
	item: Doc<"boardItems">,
	whiteboardId: Id<"whiteboards"> | null,
) {
	if (item.kind !== "card" || !item.cardId) return null; // cards only (scope decision)

	// Refuse to restore onto an archived/missing board.
	const parent = whiteboardId ? await ctx.db.get(whiteboardId) : null;
	if (whiteboardId && (!parent || parent.archivedAt !== null)) {
		return null;
	}

	const now = Date.now();
	await ctx.db.patch(item._id, { archivedAt: null, updatedAt: now });

	const card = await ctx.db.get(item.cardId);
	if (!card) {
		throw new Error("Card not found");
	}
	if (card && card.archivedAt !== null) {
		await ctx.db.patch(card._id, {
			archivedAt: null,
			updatedAt: now,
		});
	}
	await incrementActivePlacementCount(ctx, card._id);
	await reconcileCardFileRefs(ctx, card._id, card.content);
	await reconcileCardReferences(ctx, card._id, card.content);
	if (parent) {
		await ctx.db.patch(parent._id, {
			cardCount: (parent.cardCount ?? 0) + 1, // symmetric with archiveItem's decrement
			updatedAt: now,
		});
	}
	return item._id;
}

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

async function getActiveCardByLooseId(
	ctx: MutationCtx,
	cardId: string | undefined,
): Promise<Doc<"cards"> | null> {
	if (!cardId) return null;

	try {
		const card = await ctx.db.get(cardId as Id<"cards">);
		if (!card || card.archivedAt !== null) return null;
		return card;
	} catch {
		return null;
	}
}

export async function restoreOrAdoptCardItemImpl(
	ctx: MutationCtx,
	args: {
		whiteboardId: Id<"whiteboards"> | null;
		shapeId: string;
		sourceCardId?: string;
		content?: string;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
	},
) {
	assertValidTldrawShapeId(args.shapeId);
	const existing = await getExistingItem(ctx, args.whiteboardId, args.shapeId);

	// (a) Undo-of-delete: a row already exists for this shapeId.
	if (existing) {
		if (existing.archivedAt === null) return existing._id; // already active
		return await restoreArchivedCardItem(ctx, existing, args.whiteboardId);
	}

	// Cards require a real whiteboard.
	if (!args.whiteboardId) return null; // root board hosts no cards
	const whiteboard = await getActiveWhiteboard(ctx, args.whiteboardId);

	// (b) Paste / duplicate existing Convex card: create another placement on
	// this board that points at the same underlying card.
	const sourceCard = await getActiveCardByLooseId(ctx, args.sourceCardId);
	if (sourceCard) {
		const now = Date.now();

		const itemId = await ctx.db.insert("boardItems", {
			whiteboardId: whiteboard._id,
			kind: "card",
			cardId: sourceCard._id,
			childWhiteboardId: null,
			shapeId: args.shapeId,
			x: args.x,
			y: args.y,
			w: args.w,
			h: args.h,
			rotation: args.rotation,
			zIndex: now,
			archivedAt: null,
			updatedAt: now,
		});
		await incrementActivePlacementCount(ctx, sourceCard._id);

		await ctx.db.patch(whiteboard._id, {
			cardCount: (whiteboard.cardCount ?? 0) + 1,
			updatedAt: now,
		});

		await ctx.db.patch(sourceCard._id, {
			updatedAt: now,
		});

		return itemId;
	}

	// (c) Paste / duplicate local or stale card: adopt the carried content
	// into a fresh, independent card.
	const content = parseCardContent(args.content);
	const now = Date.now();
	const metadata = deriveCardMetadata(content);
	const cardId = await ctx.db.insert("cards", {
		whiteboardId: null,
		content,
		derivedTitle: metadata.derivedTitle,
		plainText: metadata.plainText,
		preview: metadata.preview,
		version: 1,
		activePlacementCount: 1,
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
		w: args.w,
		h: args.h,
		rotation: args.rotation,
		zIndex: now,
		archivedAt: null,
		updatedAt: now,
	});

	await ctx.db.patch(whiteboard._id, {
		cardCount: (whiteboard.cardCount ?? 0) + 1,
		updatedAt: now,
	});
	await reconcileCardFileRefs(ctx, cardId, content);
	await reconcileCardReferences(ctx, cardId, content);

	return itemId;
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

	await clearCardFileRefs(ctx, cardId);
	await clearCardReferences(ctx, cardId);
	await setActivePlacementCount(ctx, card._id, 0);
	await ctx.db.patch(card._id, {
		archivedAt,
		updatedAt: archivedAt,
	});
}

async function archiveWhiteboardTree(
	ctx: MutationCtx,
	whiteboard: Doc<"whiteboards">,
	options: { archivedAt: number; deleteCards: boolean },
) {
	if (whiteboard.archivedAt === null) {
		await clearTldrawFileRefs(ctx, whiteboard._id);
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
		await clearTldrawFileRefs(ctx, descendant._id);
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
			const nextPlacementCount = await decrementActivePlacementCount(
				ctx,
				item.cardId,
			);
			if (options.deleteCards) {
				if (nextPlacementCount === 0) {
					await archiveCard(ctx, item.cardId, options.archivedAt);
				}
			}
		}
	}
}
