import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { clearCardFileRefs, reconcileCardFileRefs } from "./fileLifecycle";
import { deriveCardMetadata } from "./model/cardMetadata";
import {
	getPreferredPlacement,
	hasActivePlacementOnBoard,
	listActivePlacements,
} from "./model/cardPlacements";
import {
	DEFAULT_CARD_SORT_BY,
	cardSortByValidator,
	sortCards,
} from "./model/cardSorting";
import {
	collectCardReferenceIds,
	fetchCardTitles,
	normalizeCardReferences,
	resolveCardReferenceTitles,
} from "./model/cardReferences";

const MAX_CARD_CONTENT_BYTES = 250_000;

export const get = query({
	args: { cardId: v.id("cards") },
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) return null;

		const placements = await listActivePlacements(ctx, card._id);
		const preferredPlacement = await getPreferredPlacement(ctx, card._id);
		const whiteboard = preferredPlacement?.whiteboardId
			? await ctx.db.get(preferredPlacement.whiteboardId)
			: null;
		const backlinks: {
			cardId: Id<"cards">;
			title: string;
			preview: string;
			boardWhiteboardId: Id<"whiteboards"> | null;
			shapeId: string | null;
		}[] = [];

		for await (const candidate of ctx.db.query("cards")) {
			if (candidate._id === card._id || candidate.archivedAt !== null) continue;
			const referencedIds = collectCardReferenceIds(candidate.content);
			if (!referencedIds.includes(card._id)) continue;
			const backlinkPlacement = await getPreferredPlacement(ctx, candidate._id);
			backlinks.push({
				cardId: candidate._id,
				title: candidate.derivedTitle,
				preview: candidate.preview,
				boardWhiteboardId: backlinkPlacement?.whiteboardId ?? null,
				shapeId: backlinkPlacement?.shapeId ?? null,
			});
		}
		backlinks.sort((left, right) => left.title.localeCompare(right.title));

		const breadcrumbs = [];
		if (whiteboard && whiteboard.archivedAt === null) {
			for (const ancestorId of whiteboard.ancestorIds ?? []) {
				const ancestor = await ctx.db.get(ancestorId);
				if (ancestor && ancestor.archivedAt === null) {
					breadcrumbs.push(ancestor);
				}
			}
			breadcrumbs.push(whiteboard);
		}

		// Resolve `auto` card references to their targets' current titles so a
		// renamed card shows its latest name on a fresh read.
		const referenceIds = collectCardReferenceIds(card.content);
		const content =
			referenceIds.length > 0
				? resolveCardReferenceTitles(
						card.content,
						await fetchCardTitles(ctx, referenceIds),
					)
				: card.content;

		// The card's placement on a board, so callers (e.g. the preview dialog)
		// can offer "focus on board" / "go to board".
		return {
			card: { ...card, content },
			whiteboard: whiteboard && whiteboard.archivedAt === null ? whiteboard : null,
			breadcrumbs,
			placements: placements.map((placement) => ({
				itemId: placement._id,
				whiteboardId: placement.whiteboardId,
				shapeId: placement.shapeId,
				updatedAt: placement.updatedAt,
			})),
			backlinks,
			boardWhiteboardId: preferredPlacement?.whiteboardId ?? null,
			shapeId: preferredPlacement?.shapeId ?? null,
		};
	},
});

export const updateContent = mutation({
	args: {
		cardId: v.id("cards"),
		content: v.any(),
		expectedVersion: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) {
			throw new Error("Card not found");
		}

		if (
			args.expectedVersion !== undefined &&
			args.expectedVersion !== card.version
		) {
			throw new Error("Card was updated elsewhere");
		}

		const reconciledContent = await reconcileCardFileRefs(
			ctx,
			card._id,
			args.content,
		);
		// Normalize card-reference link marks: canonical href, auto/custom label
		// tracking, and refreshed resolved titles.
		const referenceIds = collectCardReferenceIds(reconciledContent);
		const nextContent =
			referenceIds.length > 0
				? normalizeCardReferences(
						reconciledContent,
						await fetchCardTitles(ctx, referenceIds),
					)
				: reconciledContent;
		const serializedContent = JSON.stringify(nextContent);
		if (serializedContent.length > MAX_CARD_CONTENT_BYTES) {
			throw new Error("Card content is too large");
		}

		const now = Date.now();
		const metadata = deriveCardMetadata(nextContent);
		await ctx.db.patch(card._id, {
			content: nextContent,
			derivedTitle: metadata.derivedTitle,
			plainText: metadata.plainText,
			preview: metadata.preview,
			version: card.version + 1,
			updatedAt: now,
		});
		const placements = await listActivePlacements(ctx, card._id);
		for (const placement of placements) {
			if (!placement.whiteboardId) continue;
			await ctx.db.patch(placement.whiteboardId, {
				updatedAt: now,
			});
		}

		return card.version + 1;
	},
});

export const listByWhiteboard = query({
	args: {
		whiteboardId: v.id("whiteboards"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const placements = await ctx.db
			.query("boardItems")
			.withIndex("by_whiteboard_archived_z", (q) =>
				q.eq("whiteboardId", args.whiteboardId).eq("archivedAt", null),
			)
			.collect();

		const cardsById = new Map<Id<"cards">, Doc<"cards">>();
		for (const card of (
			await Promise.all(
				placements
					.filter((item) => item.kind === "card" && item.cardId)
					.map(async (item) => (item.cardId ? await ctx.db.get(item.cardId) : null)),
			)
		).filter((card): card is Doc<"cards"> => !!card && card.archivedAt === null)) {
			cardsById.set(card._id, card);
		}
		const cards = [...cardsById.values()].sort(
			(left, right) => right._creationTime - left._creationTime,
		);

		const start = parseOffsetCursor(args.paginationOpts.cursor);
		const end = Math.min(start + args.paginationOpts.numItems, cards.length);

		return {
			isDone: end >= cards.length,
			page: cards.slice(start, end),
			continueCursor: String(end),
		};
	},
});

export const listOrphans = query({
	args: {
		paginationOpts: paginationOptsValidator,
		searchTerm: v.optional(v.string()),
		sortBy: v.optional(cardSortByValidator),
	},
	handler: async (ctx, args) => {
		const activeCards = await ctx.db
			.query("cards")
			.filter((q) => q.eq(q.field("archivedAt"), null))
			.collect();

		const activeCardsFiltered =
			args.searchTerm?.trim()
				? activeCards.filter((card) => {
						const term = args.searchTerm!.toLowerCase();
						return (
							card.plainText.toLowerCase().includes(term) ||
							card.derivedTitle.toLowerCase().includes(term)
						);
					})
				: activeCards;

		const placementCounts = new Map<Id<"cards">, number>();
		for await (const item of ctx.db.query("boardItems")) {
			if (
				item.archivedAt === null &&
				item.kind === "card" &&
				item.cardId !== null
			) {
				placementCounts.set(
					item.cardId,
					(placementCounts.get(item.cardId) ?? 0) + 1,
				);
			}
		}

		const orphans = activeCardsFiltered.filter(
			(card) => (placementCounts.get(card._id) ?? 0) === 0,
		);
		const sortedOrphans = sortCards(
			orphans,
			args.sortBy ?? DEFAULT_CARD_SORT_BY,
		);
		const start = parseOffsetCursor(args.paginationOpts.cursor);
		const end = Math.min(
			start + args.paginationOpts.numItems,
			sortedOrphans.length,
		);

		return {
			isDone: end >= sortedOrphans.length,
			page: sortedOrphans.slice(start, end),
			continueCursor: String(end),
		};
	},
});

export const listAll = query({
	args: {
		paginationOpts: paginationOptsValidator,
		searchTerm: v.optional(v.string()),
		orphanOnly: v.optional(v.boolean()),
		sortBy: v.optional(cardSortByValidator),
	},
	handler: async (ctx, args) => {
		const activeCards = await ctx.db
			.query("cards")
			.filter((q) => q.eq(q.field("archivedAt"), null))
			.collect();

		const placementCounts = new Map<Id<"cards">, number>();
		for await (const item of ctx.db.query("boardItems")) {
			if (
				item.archivedAt === null &&
				item.kind === "card" &&
				item.cardId !== null
			) {
				placementCounts.set(
					item.cardId,
					(placementCounts.get(item.cardId) ?? 0) + 1,
				);
			}
		}

		let filtered = activeCards;

		if (args.searchTerm?.trim()) {
			const term = args.searchTerm!.toLowerCase();
			filtered = filtered.filter(
				(card) =>
					card.plainText.toLowerCase().includes(term) ||
					card.derivedTitle.toLowerCase().includes(term),
			);
		}

		if (args.orphanOnly) {
			filtered = filtered.filter(
				(card) => (placementCounts.get(card._id) ?? 0) === 0,
			);
		}

		const sortedCards = sortCards(
			filtered,
			args.sortBy ?? DEFAULT_CARD_SORT_BY,
		);
		const withCounts = sortedCards
			.map((card) => ({
				...card,
				placementCount: placementCounts.get(card._id) ?? 0,
			}));

		const start = parseOffsetCursor(args.paginationOpts.cursor);
		const end = Math.min(start + args.paginationOpts.numItems, withCounts.length);

		return {
			isDone: end >= withCounts.length,
			page: withCounts.slice(start, end),
			continueCursor: String(end),
		};
	},
});

export const archiveCard = mutation({
	args: { cardId: v.id("cards") },
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) return;

		const now = Date.now();
		const placements = await listActivePlacements(ctx, card._id);
		for (const placement of placements) {
			await ctx.db.patch(placement._id, {
				archivedAt: now,
				updatedAt: now,
			});

			if (!placement.whiteboardId) continue;
			const whiteboard = await ctx.db.get(placement.whiteboardId);
			if (whiteboard && whiteboard.archivedAt === null) {
				await ctx.db.patch(whiteboard._id, {
					cardCount: Math.max(0, (whiteboard.cardCount ?? 0) - 1),
					updatedAt: now,
				});
			}
		}

		await clearCardFileRefs(ctx, card._id);
		await ctx.db.patch(card._id, {
			archivedAt: now,
			updatedAt: now,
		});
	},
});

export const appendToWhiteboard = mutation({
	args: {
		cardId: v.id("cards"),
		whiteboardId: v.id("whiteboards"),
	},
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card || card.archivedAt !== null) {
			throw new Error("Card not found");
		}

		const whiteboard = await ctx.db.get(args.whiteboardId);
		if (!whiteboard || whiteboard.archivedAt !== null) {
			throw new Error("Whiteboard not found");
		}

		if (await hasActivePlacementOnBoard(ctx, card._id, whiteboard._id)) {
			return null;
		}

		const now = Date.now();
		const shapeId = `card-${card._id}`;
		const existingItem = await ctx.db
			.query("boardItems")
			.withIndex("by_whiteboard_shape", (q) =>
				q.eq("whiteboardId", whiteboard._id).eq("shapeId", shapeId),
			)
			.first();

		if (existingItem && existingItem.archivedAt !== null) {
			await ctx.db.patch(existingItem._id, {
				archivedAt: null,
				updatedAt: now,
			});
		} else if (!existingItem) {
			await ctx.db.insert("boardItems", {
				whiteboardId: whiteboard._id,
				kind: "card",
				cardId: card._id,
				childWhiteboardId: null,
				shapeId,
				x: 0,
				y: (whiteboard.cardCount ?? 0) * 40,
				w: 576,
				h: 160,
				rotation: 0,
				zIndex: now,
				archivedAt: null,
				updatedAt: now,
			});
		}

		await ctx.db.patch(whiteboard._id, {
			cardCount: (whiteboard.cardCount ?? 0) + 1,
			updatedAt: now,
		});

		await ctx.db.patch(card._id, {
			updatedAt: now,
		});
	},
});

function parseOffsetCursor(cursor: string | null) {
	if (cursor === null) {
		return 0;
	}

	const offset = Number.parseInt(cursor, 10);
	return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}
