import {
	type ArrangeEdge,
	type ArrangeNode,
	type ArrangeStyle,
	arrangeRelationLayout,
	buildArrowRelationRecords,
	collectArrowRelationRecordIds,
	collectDirectedArrowRelations,
} from "@contextboard/application/canvas";
import {
	cardContentToTextWithReferences,
	textToCardContentWithReferences,
} from "@contextboard/application/cards";
// The package root re-exports React components; the runtime entry point is the
// JSX-free one, which is what a headless server needs.
import type {
	CanvasService,
	CardRelationsService,
	CardsService,
	WhiteboardsService,
} from "@contextboard/application/runtime";

/**
 * The tool surface an agent sees.
 *
 * Every tool is a thin wrapper over an existing application service, so the
 * planners that keep references, placements and tombstones consistent are the
 * same ones the desktop and web UIs use. Nothing here reimplements domain
 * logic, and nothing here validates beyond what the data model genuinely
 * requires — guidance for the agent belongs in the descriptions below, not in
 * rules that would box the user in.
 */
export type ToolServices = {
	cards: CardsService;
	whiteboards: WhiteboardsService;
	canvas: CanvasService;
	relations: CardRelationsService;
};

export type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export const REFERENCE_GUIDANCE = `Card text is markdown: headings, bullet and numbered lists, blockquotes, fenced code, pipe tables and inline math all round trip. To cite another card, write [label](contextboard:card/<cardId>) inline; to cite a whiteboard, write [label](contextboard:whiteboard/<whiteboardId>). Put references in the sentence that makes the claim; each creates a real reference and a backlink on its target. Prefer citing sources this way over listing them at the end.`;

function object(
	properties: Record<string, unknown>,
	required: string[] = [],
): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

const string = (description: string) => ({ type: "string", description });
const stringOrNull = (description: string) => ({
	type: ["string", "null"],
	description,
});
const number = (description: string) => ({ type: "number", description });
const boolean = (description: string) => ({ type: "boolean", description });

function requireString(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== "string" || !value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function optionalString(
	input: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = input[key];
	return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(
	input: Record<string, unknown>,
	key: string,
): number | undefined {
	const value = input[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export const PLACEMENT_GUIDANCE = `Leave x and y out and the card is placed automatically in free space beside the board's existing cards, which is usually what you want. Pass them only when the layout carries meaning — read the current layout with list_board_items first. Note that x: 0, y: 0 is a literal position, not "auto". Cards default to 576 wide, and their height is estimated from the content unless you pass h — leave h out unless you specifically need a fixed size.`;

/** The frame arguments shared by the tools that put a card on a board. */
const frameProperties = {
	x: number("Canvas x position. Omit for automatic placement."),
	y: number("Canvas y position. Omit for automatic placement."),
	w: number("Card width in canvas units. Defaults to 576."),
	h: number(
		"Card height in canvas units. Omit to have it estimated from the card's content.",
	),
};

function readFrame(input: Record<string, unknown>) {
	return {
		x: optionalNumber(input, "x"),
		y: optionalNumber(input, "y"),
		w: optionalNumber(input, "w"),
		h: optionalNumber(input, "h"),
	};
}

/** tldraw shape ids are opaque, but must carry the `shape:` prefix. */
function newShapeId(): string {
	return `shape:${crypto.randomUUID()}`;
}

export function createTools(services: ToolServices): ToolDefinition[] {
	const { cards, whiteboards, canvas, relations } = services;

	return [
		{
			name: "list_whiteboards",
			description:
				"List every whiteboard in the workspace, with its parent, depth, and how many cards and child whiteboards it holds. Start here to find where existing work lives before creating anything new.",
			inputSchema: object({}),
			handler: () => whiteboards.list(),
		},
		{
			name: "get_whiteboard",
			description:
				"Get one whiteboard with its breadcrumb trail from the root.",
			inputSchema: object(
				{ whiteboardId: string("The whiteboard to fetch.") },
				["whiteboardId"],
			),
			handler: (input) => whiteboards.get(requireString(input, "whiteboardId")),
		},
		{
			name: "create_whiteboard",
			description:
				"Create a whiteboard and a clickable link shape to it. Omit parentWhiteboardId to place the link on the virtual root board, or pass one to nest the link inside that whiteboard. Whiteboards are how a body of research is grouped; prefer a sub-whiteboard over a sprawling flat board.",
			inputSchema: object({
				title: string("Title for the new whiteboard."),
				parentWhiteboardId: string(
					"Nest under this whiteboard. Omit for a top-level board.",
				),
			}),
			handler: async (input) => {
				const title = optionalString(input, "title");
				const parentWhiteboardId = optionalString(input, "parentWhiteboardId");
				const created = await whiteboards.createSubwhiteboard({
					parentWhiteboardId: parentWhiteboardId ?? null,
					shapeId: newShapeId(),
				});
				const whiteboardId = created.childWhiteboardId;
				if (title) await whiteboards.rename({ whiteboardId, title });
				return { whiteboardId, itemId: created.itemId, title: title ?? null };
			},
		},
		{
			name: "rename_whiteboard",
			description:
				"Change a whiteboard's title. The title is how the board is identified in listings and in its parent's link shape, so make it describe the body of work it holds.",
			inputSchema: object(
				{
					whiteboardId: string("The whiteboard to rename."),
					title: string("The new title."),
				},
				["whiteboardId", "title"],
			),
			handler: (input) =>
				whiteboards.rename({
					whiteboardId: requireString(input, "whiteboardId"),
					title: requireString(input, "title"),
				}),
		},
		{
			name: "archive_whiteboard",
			description:
				"Archive a whiteboard and everything nested inside it. By default the cards it held survive and become unplaced; pass deleteCards to archive them too.",
			inputSchema: object(
				{
					whiteboardId: string("The whiteboard to archive."),
					deleteCards: boolean(
						"Also archive the cards placed on it. Defaults to false.",
					),
				},
				["whiteboardId"],
			),
			handler: async (input) => {
				await whiteboards.archive(requireString(input, "whiteboardId"), {
					deleteCards: input.deleteCards === true,
				});
				return { archived: true };
			},
		},
		{
			name: "list_cards",
			description:
				"List cards across the whole workspace with their titles and previews. Use orphanOnly to find cards that are not placed on any whiteboard.",
			inputSchema: object({
				searchTerm: string("Filter by a term appearing in the card text."),
				sortBy: {
					type: "string",
					enum: ["updated_desc", "updated_asc", "title", "title_desc"],
					description: "Sort order. Defaults to most recently updated first.",
				},
				orphanOnly: boolean("Only cards with no whiteboard placement."),
			}),
			handler: (input) =>
				cards.list({
					searchTerm: optionalString(input, "searchTerm"),
					sortBy: optionalString(input, "sortBy") as never,
					orphanOnly: input.orphanOnly === true,
				}),
		},
		{
			name: "search_cards",
			description:
				"Full-text search across cards. Returns matches with enough context to decide which to open. Search before writing a new card, so related work is extended rather than duplicated.",
			inputSchema: object(
				{
					query: string("Text to search for."),
					limit: number("Maximum results. Defaults to the service default."),
					whiteboardId: string(
						"Scope an empty query to one board's recent cards.",
					),
				},
				["query"],
			),
			handler: (input) =>
				cards.search({
					query: requireString(input, "query"),
					limit: optionalNumber(input, "limit"),
					whiteboardId: optionalString(input, "whiteboardId"),
				}),
		},
		{
			name: "get_card",
			description: `Read one card: its full text, every whiteboard it is placed on, and its backlinks (the cards that cite it). Follow backlinks to traverse the knowledge graph. ${REFERENCE_GUIDANCE}`,
			inputSchema: object({ cardId: string("The card to read.") }, ["cardId"]),
			handler: async (input) => {
				const card = await cards.get(requireString(input, "cardId"));
				if (!card) return null;
				const { content, ...rest } = card;
				return { ...rest, text: cardContentToTextWithReferences(content) };
			},
		},
		{
			name: "create_card",
			description: `Create a card. The first line becomes its title, so make it a specific claim or topic rather than a generic label. Pass whiteboardId to place it on a board at the same time. ${PLACEMENT_GUIDANCE} ${REFERENCE_GUIDANCE}`,
			inputSchema: object(
				{
					text: string(
						"The card's content. First line is the title; the rest is the body.",
					),
					whiteboardId: string(
						"Place the new card on this whiteboard. Omit to leave it unplaced.",
					),
					...frameProperties,
				},
				["text"],
			),
			handler: async (input) => {
				const text = requireString(input, "text");
				const cardId = await cards.create({
					content: textToCardContentWithReferences(text),
				});
				const whiteboardId = optionalString(input, "whiteboardId");
				// The frame is meaningless without a board to place the card on.
				const placement = whiteboardId
					? await cards.appendToWhiteboard({
							cardId,
							whiteboardId,
							...readFrame(input),
						})
					: null;
				return { cardId, placement };
			},
		},
		{
			name: "update_card",
			description: `Replace a card's text. This overwrites the whole card, so read it first with get_card and send back the full revised text. References are recomputed from the new text, so a citation dropped here also drops the backlink. ${REFERENCE_GUIDANCE}`,
			inputSchema: object(
				{
					cardId: string("The card to update."),
					text: string("The card's complete new content."),
					expectedVersion: number(
						"Fail if the card has changed since this version, to avoid overwriting a concurrent edit.",
					),
				},
				["cardId", "text"],
			),
			handler: async (input) => {
				const version = await cards.updateContent({
					cardId: requireString(input, "cardId"),
					content: textToCardContentWithReferences(
						requireString(input, "text"),
					),
					expectedVersion: optionalNumber(input, "expectedVersion"),
				});
				return { version };
			},
		},
		{
			name: "archive_card",
			description:
				"Archive a card and remove it from every whiteboard it was placed on.",
			inputSchema: object({ cardId: string("The card to archive.") }, [
				"cardId",
			]),
			handler: async (input) => {
				await cards.delete(requireString(input, "cardId"));
				return { archived: true };
			},
		},
		{
			name: "list_board_items",
			description:
				"List what is placed on a whiteboard — cards and sub-whiteboard links — with their positions and sizes. Use this to see a board's layout before adding to it.",
			inputSchema: object(
				{
					whiteboardId: stringOrNull(
						"The whiteboard to inspect. Pass null for the root board.",
					),
				},
				["whiteboardId"],
			),
			handler: (input) =>
				canvas.listItems(optionalString(input, "whiteboardId") ?? null),
		},
		{
			name: "place_card",
			description: `Place an existing card on a whiteboard. A card can appear on several whiteboards at once, and each placement is independent. ${PLACEMENT_GUIDANCE}`,
			inputSchema: object(
				{
					cardId: string("The card to place."),
					whiteboardId: string("The whiteboard to place it on."),
					...frameProperties,
				},
				["cardId", "whiteboardId"],
			),
			handler: async (input) =>
				// The frame goes in with the append, so the card is never briefly
				// visible at the origin. Going through restoreOrAdoptCardItem
				// instead would be paste-resolution semantics: it only links an
				// existing card when the source workspace matches, and silently
				// creates a duplicate otherwise.
				(await cards.appendToWhiteboard({
					cardId: requireString(input, "cardId"),
					whiteboardId: requireString(input, "whiteboardId"),
					...readFrame(input),
				})) ?? null,
		},
		{
			name: "move_item",
			description:
				"Move or resize something already placed on a whiteboard — a card or a sub-whiteboard link. Get itemId and the current layout from list_board_items. Anything you leave out keeps its current value, so passing only x and y moves the item without resizing it. This edits the user's board directly, so keep changes purposeful.",
			inputSchema: object(
				{
					whiteboardId: stringOrNull(
						"The whiteboard the item is on. Pass null for the root board.",
					),
					itemId: string("The placement to move, from list_board_items."),
					x: number("New canvas x position."),
					y: number("New canvas y position."),
					w: number("New width in canvas units."),
					h: number("New height in canvas units."),
					rotation: number("New rotation in radians."),
				},
				["whiteboardId", "itemId"],
			),
			handler: async (input) => {
				const itemId = requireString(input, "itemId");
				const items = await canvas.listItems(
					optionalString(input, "whiteboardId") ?? null,
				);
				const item = items.find((row) => row.id === itemId);
				if (!item) throw new Error(`item ${itemId} is not on this whiteboard`);
				const frame = {
					itemId,
					x: optionalNumber(input, "x") ?? item.x,
					y: optionalNumber(input, "y") ?? item.y,
					w: optionalNumber(input, "w") ?? item.w,
					h: optionalNumber(input, "h") ?? item.h,
					rotation: optionalNumber(input, "rotation") ?? item.rotation,
					zIndex: item.zIndex,
				};
				await canvas.updateItemFrame(frame);
				return frame;
			},
		},
		{
			name: "archive_item",
			description:
				"Remove one placement from a whiteboard. The card itself survives and stays on any other board; pass deleteCards to archive the card as well.",
			inputSchema: object(
				{
					itemId: string("The placement to remove, from list_board_items."),
					deleteCards: boolean(
						"Also archive the card behind this placement. Defaults to false.",
					),
				},
				["itemId"],
			),
			handler: async (input) => {
				await canvas.archiveItem({
					itemId: requireString(input, "itemId"),
					deleteCards: input.deleteCards === true,
				});
				return { archived: true };
			},
		},
		{
			name: "list_relations",
			description:
				"List the arrow relations on a whiteboard, or every relation touching one card. Relations come from arrows drawn between cards on a board: they are scoped to that board, run from a source card to a target card, and carry no label — their meaning is whatever the person who drew them intended, so do not assume a semantic. This is distinct from a card reference, which lives in a card's text and is global. Both you and the user can draw these arrows; use create_relation to add one.",
			inputSchema: object({
				whiteboardId: string("Only relations on this whiteboard."),
				cardId: string("Only relations touching this card."),
			}),
			handler: (input) =>
				relations.list({
					whiteboardId: optionalString(input, "whiteboardId"),
					cardId: optionalString(input, "cardId"),
				}),
		},
		{
			name: "create_relation",
			description:
				"Draw an arrow between two cards on a whiteboard, linking them. Both cards must already be placed on that board — call place_card first if one is missing. The arrow is a real one: the user sees it on the canvas and can drag or delete it. It points from source to target and keeps that direction, which arrange_cards reads as parent to child, but it carries no label, so put any explanation in the cards themselves. Relating the same pair twice returns the existing relation instead of drawing a duplicate.",
			inputSchema: object(
				{
					whiteboardId: string("The whiteboard both cards are placed on."),
					sourceCardId: string("The card the arrow starts at."),
					targetCardId: string("The card the arrow points at."),
				},
				["whiteboardId", "sourceCardId", "targetCardId"],
			),
			handler: async (input) => {
				const whiteboardId = requireString(input, "whiteboardId");
				const sourceCardId = requireString(input, "sourceCardId");
				const targetCardId = requireString(input, "targetCardId");
				if (sourceCardId === targetCardId) {
					throw new Error("A card cannot relate to itself");
				}

				const items = await canvas.listItems(whiteboardId);
				const shapeIdFor = (cardId: string) => {
					const item = items.find(
						(row) => row.kind === "card" && row.cardId === cardId,
					);
					if (!item) {
						throw new Error(
							`Card ${cardId} is not on whiteboard ${whiteboardId}. Place it with place_card first.`,
						);
					}
					return item.shapeId;
				};
				const sourceShapeId = shapeIdFor(sourceCardId);
				const targetShapeId = shapeIdFor(targetCardId);

				// An existing arrow between the same pair is reused, so repeating a
				// call never litters the canvas.
				const existing = await relations.list({
					whiteboardId,
					cardId: sourceCardId,
				});
				const duplicate = existing.find(
					(row) =>
						row.arrowShapeId !== null &&
						((row.sourceCardId === sourceCardId &&
							row.targetCardId === targetCardId) ||
							(row.sourceCardId === targetCardId &&
								row.targetCardId === sourceCardId)),
				);
				if (duplicate) return duplicate;

				const document = await canvas.getDocument(whiteboardId);
				const records = Object.values(
					(document?.snapshot as { store?: Record<string, unknown> } | null)
						?.store ?? {},
				);
				const built = buildArrowRelationRecords({
					sourceShapeId,
					targetShapeId,
					records,
				});
				await canvas.applyRecordChanges({
					whiteboardId,
					added: built.records,
					updated: [],
					removed: [],
				});
				// The relation row is normally derived by the app when it has the
				// board open. Writing it here too means the relation is readable
				// immediately; the id matches what a later reconcile derives, so the
				// two agree instead of duplicating.
				return relations.create({
					whiteboardId,
					sourceCardId,
					targetCardId,
					arrowShapeId: built.arrowShapeId,
				});
			},
		},
		{
			name: "delete_relation",
			description:
				"Remove a relation and the arrow that carries it. The two cards themselves are untouched and stay on the board. Pass an id from list_relations.",
			inputSchema: object(
				{ relationId: string("The relation to remove, from list_relations.") },
				["relationId"],
			),
			handler: async (input) => {
				const relationId = requireString(input, "relationId");
				const relation = (await relations.list()).find(
					(row) => row.id === relationId,
				);
				if (!relation) return { deleted: false };

				if (relation.arrowShapeId) {
					const document = await canvas.getDocument(relation.whiteboardId);
					const records = Object.values(
						(document?.snapshot as { store?: Record<string, unknown> } | null)
							?.store ?? {},
					);
					await canvas.applyRecordChanges({
						whiteboardId: relation.whiteboardId,
						added: [],
						updated: [],
						removed: collectArrowRelationRecordIds(
							relation.arrowShapeId,
							records,
						),
					});
				}
				await relations.archive({
					relationId,
					expectedRevision: relation.revision,
				});
				return { deleted: true };
			},
		},
		{
			name: "arrange_cards",
			description:
				"Lay the cards on a whiteboard out from the arrows between them, as a tree, mindmap, or compact graph. Draw the relations you want with create_relation and then call this instead of working out coordinates yourself. It reads the arrow directions for tree layouts. Cards with no relation are left exactly where they are, as is anything the user drew by hand, and the arrangement is centred on where the cards already were so the board does not jump. Pass cardIds to arrange only part of the board; everything else then counts as an obstacle to keep clear of.",
			inputSchema: object(
				{
					whiteboardId: string("The whiteboard to arrange."),
					cardIds: {
						type: "array",
						items: { type: "string" },
						description:
							"Only arrange these cards. Omit to arrange every card on the board.",
					},
					style: {
						type: "string",
						enum: [
							"auto",
							"tree-horizontal",
							"tree-vertical",
							"mindmap",
							"graph",
						],
						description:
							"Layout to use. Defaults to auto, which keeps tree-shaped structures as trees or mindmaps and picks graph for dense, cross-linked structures.",
					},
				},
				["whiteboardId"],
			),
			handler: async (input) => {
				const whiteboardId = requireString(input, "whiteboardId");
				const style = (optionalString(input, "style") ??
					"auto") as ArrangeStyle;
				const only = Array.isArray(input.cardIds)
					? new Set(
							input.cardIds.filter(
								(value): value is string => typeof value === "string",
							),
						)
					: null;

				const items = await canvas.listItems(whiteboardId);
				const cardItems = items.filter(
					(item) => item.kind === "card" && item.cardId,
				);
				const chosen = only
					? cardItems.filter((item) => only.has(item.cardId as string))
					: cardItems;

				const itemByShapeId = new Map(
					chosen.map((item) => [item.shapeId, item]),
				);
				const nodes: ArrangeNode[] = chosen.map((item) => ({
					id: item.shapeId,
					x: item.x,
					y: item.y,
					w: item.w,
					h: item.h,
				}));

				// Direction has to come from the arrows themselves: the relation index
				// canonicalises its endpoints, so it cannot say which card is the parent.
				const document = await canvas.getDocument(whiteboardId);
				const records = Object.values(
					(document?.snapshot as { store?: Record<string, unknown> } | null)
						?.store ?? {},
				);
				const edges: ArrangeEdge[] = [];
				for (const relation of collectDirectedArrowRelations(records)) {
					if (!itemByShapeId.has(relation.sourceShapeId)) continue;
					if (!itemByShapeId.has(relation.targetShapeId)) continue;
					edges.push({
						source: relation.sourceShapeId,
						target: relation.targetShapeId,
					});
				}

				const obstacles = items
					.filter((item) => !itemByShapeId.has(item.shapeId))
					.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }));

				const layout = arrangeRelationLayout(nodes, edges, {
					style,
					obstacles,
				});

				const arranged: {
					itemId: string;
					cardId: string;
					x: number;
					y: number;
				}[] = [];
				const frameUpdates: Array<{
					itemId: string;
					x: number;
					y: number;
					w: number;
					h: number;
					rotation: number;
					zIndex: number;
				}> = [];
				for (const [shapeId, position] of layout.positions) {
					const item = itemByShapeId.get(shapeId);
					if (!item) continue;
					frameUpdates.push({
						itemId: item.id,
						x: position.x,
						y: position.y,
						w: item.w,
						h: item.h,
						rotation: item.rotation,
						zIndex: item.zIndex,
					});
					arranged.push({
						itemId: item.id,
						cardId: item.cardId as string,
						x: position.x,
						y: position.y,
					});
				}
				if (frameUpdates.length > 0) {
					await canvas.updateItemFrames({ updates: frameUpdates });
				}

				return {
					style: layout.style,
					arranged,
					skippedCardIds: layout.skippedIds.flatMap((shapeId) => {
						const cardId = itemByShapeId.get(shapeId)?.cardId;
						return cardId ? [cardId] : [];
					}),
				};
			},
		},
	];
}
