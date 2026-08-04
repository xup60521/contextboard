/**
 * Builds the tldraw records behind an arrow relation.
 *
 * Arrows are the source of truth for card relations, and `cardRelation` rows are
 * the derived index over them. Drawing an arrow normally happens inside a live
 * `Editor`, but the canvas is stored per record (entity `canvasRecord`), so a
 * headless caller — the local agent server — can write the same records directly.
 *
 * The payloads here have to satisfy tldraw's own schema: a malformed record is
 * accepted by the repository and only explodes later, when someone opens the
 * board. `arrow-records.test.ts` validates everything this module emits against
 * `@tldraw/tlschema`, so keep the defaults below in step with tldraw's
 * `ArrowShapeUtil.getDefaultProps()` / `ArrowBindingUtil.getDefaultProps()`.
 */

import { getIndexAbove } from "@tldraw/utils";

/** tldraw's default page id, used when a board has no page record yet. */
const DEFAULT_PAGE_ID = "page:page";

/** Mirrors `ArrowShapeUtil.getDefaultProps()` in tldraw 3.15.6. */
function defaultArrowProps() {
	return {
		kind: "arc",
		elbowMidPoint: 0.5,
		dash: "draw",
		size: "m",
		fill: "none",
		color: "black",
		labelColor: "black",
		bend: 0,
		// Terminals are driven by the bindings; these are the unbound fallback.
		start: { x: 0, y: 0 },
		end: { x: 2, y: 0 },
		arrowheadStart: "none",
		arrowheadEnd: "arrow",
		text: "",
		labelPosition: 0.5,
		font: "draw",
		scale: 1,
	};
}

/** Mirrors `ArrowBindingUtil.getDefaultProps()` in tldraw 3.15.6. */
function defaultArrowBindingProps(terminal: "start" | "end") {
	return {
		terminal,
		isPrecise: false,
		isExact: false,
		normalizedAnchor: { x: 0.5, y: 0.5 },
		snap: "none",
	};
}

type RecordLike = {
	id?: unknown;
	typeName?: unknown;
	index?: unknown;
	parentId?: unknown;
};

function asRecord(value: unknown): RecordLike | null {
	return value && typeof value === "object" ? (value as RecordLike) : null;
}

/**
 * Picks the page an agent-drawn arrow belongs on.
 *
 * Boards created by the app always have exactly one page; taking the
 * lowest-sorting id keeps the choice stable if that ever stops being true.
 */
function resolvePageId(records: readonly unknown[]): string {
	const pageIds: string[] = [];
	for (const value of records) {
		const record = asRecord(value);
		if (record?.typeName === "page" && typeof record.id === "string") {
			pageIds.push(record.id);
		}
	}
	if (pageIds.length === 0) return DEFAULT_PAGE_ID;
	return pageIds.sort()[0];
}

/** An index that sorts above every shape already on the page. */
function resolveIndex(records: readonly unknown[], parentId: string): string {
	let max: string | null = null;
	for (const value of records) {
		const record = asRecord(value);
		if (record?.typeName !== "shape") continue;
		if (record.parentId !== parentId) continue;
		if (typeof record.index !== "string") continue;
		if (max === null || record.index > max) max = record.index;
	}
	return getIndexAbove(max as Parameters<typeof getIndexAbove>[0]);
}

function newId(prefix: "shape" | "binding"): string {
	return `${prefix}:${crypto.randomUUID()}`;
}

export type BuildArrowRelationRecordsInput = {
	/** Shape id of the card the arrow starts at. */
	sourceShapeId: string;
	/** Shape id of the card the arrow points at. */
	targetShapeId: string;
	/** Records already on the board, used to resolve the page and z-order. */
	records?: readonly unknown[];
	/** Overrides for deterministic tests. */
	arrowShapeId?: string;
	startBindingId?: string;
	endBindingId?: string;
};

export type ArrowRelationRecords = {
	arrowShapeId: string;
	startBindingId: string;
	endBindingId: string;
	/** The arrow shape followed by its start and end bindings. */
	records: unknown[];
};

/**
 * Builds an arrow shape bound to two card shapes.
 *
 * The arrow carries no semantic: it is the same undirected `related` arrow a
 * person would draw, and `reconcileCanvasRelations` projects it the same way.
 */
export function buildArrowRelationRecords(
	input: BuildArrowRelationRecordsInput,
): ArrowRelationRecords {
	if (input.sourceShapeId === input.targetShapeId) {
		throw new Error("An arrow relation needs two different shapes");
	}
	const records = input.records ?? [];
	const parentId = resolvePageId(records);
	const index = resolveIndex(records, parentId);
	const arrowShapeId = input.arrowShapeId ?? newId("shape");
	const startBindingId = input.startBindingId ?? newId("binding");
	const endBindingId = input.endBindingId ?? newId("binding");

	const arrow = {
		id: arrowShapeId,
		typeName: "shape",
		type: "arrow",
		parentId,
		index,
		x: 0,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: defaultArrowProps(),
	};

	const binding = (id: string, toId: string, terminal: "start" | "end") => ({
		id,
		typeName: "binding",
		type: "arrow",
		fromId: arrowShapeId,
		toId,
		meta: {},
		props: defaultArrowBindingProps(terminal),
	});

	return {
		arrowShapeId,
		startBindingId,
		endBindingId,
		records: [
			arrow,
			binding(startBindingId, input.sourceShapeId, "start"),
			binding(endBindingId, input.targetShapeId, "end"),
		],
	};
}

/**
 * Ids of the records that make up an arrow relation, for removal.
 *
 * Bindings are found by `fromId` rather than remembered, so an arrow a person
 * later re-bound to a different card still cleans up completely.
 */
export function collectArrowRelationRecordIds(
	arrowShapeId: string,
	records: readonly unknown[],
): string[] {
	const ids = [arrowShapeId];
	for (const value of records) {
		const record = asRecord(value) as
			| (RecordLike & { fromId?: unknown })
			| null;
		if (record?.typeName !== "binding") continue;
		if (record.fromId !== arrowShapeId) continue;
		if (typeof record.id === "string") ids.push(record.id);
	}
	return ids;
}
