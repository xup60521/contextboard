import {
	buildArrowRelationRecords,
	collectArrowRelationRecordIds,
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

const REFERENCE_GUIDANCE = `Card text is markdown: headings, bullet and numbered lists, blockquotes, fenced code, pipe tables and $…$ math all round trip. To cite another card, write [label](contextboard:card/<cardId>) inline, in the sentence that makes the claim; this creates a real reference and a backlink on the target card, and travels with the card to every whiteboard it appears on. Prefer citing sources this way over listing them at the end.`;

function object(
	properties: Record<string, unknown>,
	required: string[] = [],
): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

const string = (description: string) => ({ type: "string", description });
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
				"Create a whiteboard. Omit parentWhiteboardId for a top-level board, or pass one to nest a sub-whiteboard inside it (which also places a link shape on the parent). Whiteboards are how a body of research is grouped; prefer a sub-whiteboard over a sprawling flat board.",
			inputSchema: object({
				title: string("Title for the new whiteboard."),
				parentWhiteboardId: string(
					"Nest under this whiteboard. Omit for a top-level board.",
				),
			}),
			handler: async (input) => {
				const title = optionalString(input, "title");
				const parentWhiteboardId = optionalString(input, "parentWhiteboardId");
				let whiteboardId: string;
				let itemId: string | null = null;
				if (parentWhiteboardId) {
					const created = await whiteboards.createSubwhiteboard({
						parentWhiteboardId,
						shapeId: newShapeId(),
					});
					whiteboardId = created.childWhiteboardId;
					itemId = created.itemId;
				} else {
					whiteboardId = await whiteboards.createRoot();
				}
				if (title) await whiteboards.rename({ whiteboardId, title });
				return { whiteboardId, itemId, title: title ?? null };
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
			description: `Create a card. The first line becomes its title, so make it a specific claim or topic rather than a generic label. Pass whiteboardId to place it on a board at the same time. ${REFERENCE_GUIDANCE}`,
			inputSchema: object(
				{
					text: string(
						"The card's content. First line is the title; the rest is the body.",
					),
					whiteboardId: string(
						"Place the new card on this whiteboard. Omit to leave it unplaced.",
					),
				},
				["text"],
			),
			handler: async (input) => {
				const text = requireString(input, "text");
				const cardId = await cards.create({
					content: textToCardContentWithReferences(text),
				});
				const whiteboardId = optionalString(input, "whiteboardId");
				const placement = whiteboardId
					? await cards.appendToWhiteboard({ cardId, whiteboardId })
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
					whiteboardId: string(
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
			description:
				"Place an existing card on a whiteboard. A card can appear on several whiteboards at once, and each placement is independent. Give x and y to control layout; otherwise the card is appended in the board's default flow.",
			inputSchema: object(
				{
					cardId: string("The card to place."),
					whiteboardId: string("The whiteboard to place it on."),
					x: number("Canvas x position."),
					y: number("Canvas y position."),
				},
				["cardId", "whiteboardId"],
			),
			handler: async (input) => {
				const cardId = requireString(input, "cardId");
				const whiteboardId = requireString(input, "whiteboardId");
				const placement = await cards.appendToWhiteboard({
					cardId,
					whiteboardId,
				});
				if (!placement) return null;
				const x = optionalNumber(input, "x");
				const y = optionalNumber(input, "y");
				if (x === undefined && y === undefined) return placement;
				// Move the placement the append just made. Going through
				// restoreOrAdoptCardItem instead would be paste-resolution
				// semantics: it only links an existing card when the source
				// workspace matches, and silently creates a duplicate otherwise.
				const items = await canvas.listItems(whiteboardId);
				const item = items.find((row) => row.id === placement.itemId);
				if (item) {
					await canvas.updateItemFrame({
						itemId: item.id,
						x: x ?? item.x,
						y: y ?? item.y,
						w: item.w,
						h: item.h,
						rotation: item.rotation,
						zIndex: item.zIndex,
					});
				}
				return placement;
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
				"List the arrow relations on a whiteboard, or every relation touching one card. Relations come from arrows drawn between cards on a board: they are scoped to that board, undirected, and their meaning is whatever the person who drew them intended — do not assume a semantic. This is distinct from a card reference, which lives in a card's text and is global. Both you and the user can draw these arrows; use create_relation to add one.",
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
				"Draw an arrow between two cards on a whiteboard, linking them. Both cards must already be placed on that board — call place_card first if one is missing. The arrow is a real one: the user sees it on the canvas, can drag or delete it, and it is undirected and carries no built-in meaning, so put any explanation in the cards themselves. Relating the same pair twice returns the existing relation instead of drawing a duplicate.",
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
	];
}
