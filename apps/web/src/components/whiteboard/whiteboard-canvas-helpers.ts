import type { useNavigate } from "@tanstack/react-router";
import {
	type Editor,
	pointInPolygon,
	type TLCursor,
	type TLRecord,
	type TLShape,
	type TLShapeId,
	type TLStoreSnapshot,
	Vec,
	type VecLike,
} from "tldraw";
import type { Id } from "#/integrations/local/types";
import type { ThemeMode } from "../../lib/theme";
import type {
	MarkdownCardShape,
	SubwhiteboardLinkShape,
} from "./custom-shapes";
import { isCardContentDirty } from "./dirty-card-content";
import { frameFromItem } from "./frame-sync";
import { getHydratedMarkdownCardHeight } from "./markdown-card-sizing";
import { isManagedWhiteboardShapeRecord } from "./tldraw-persistence";

// ── Shared types ──────────────────────────────────────────────────────────────

export type BoardItemResult = {
	_id: Id<"boardItems">;
	kind: "card" | "subwhiteboard";
	cardId: Id<"cards"> | null;
	childWhiteboardId: Id<"whiteboards"> | null;
	shapeId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
	card: {
		_id: Id<"cards">;
		derivedTitle: string;
		preview: string;
		version: number;
	} | null;
	childWhiteboard: {
		_id: Id<"whiteboards">;
		title: string;
		depth: number;
		cardCount: number;
		childWhiteboardCount: number;
	} | null;
};

export type TldrawDocumentResult = {
	snapshot: TLStoreSnapshot;
	revision: number;
} | null;

export type PendingDrawingSave = {
	whiteboardId: Id<"whiteboards"> | null;
	snapshot: TLStoreSnapshot;
	expectedRevision?: number;
};

export type CameraPosition = {
	x: number;
	y: number;
	z: number;
};

export type RightDragPanState = {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	lastClientX: number;
	lastClientY: number;
	dragging: boolean;
	previousCursor: Pick<TLCursor, "type" | "rotation">;
};

export type ManagedShapePartial =
	| {
			id: TLShapeId;
			type: "markdown-card";
			x: number;
			y: number;
			rotation: number;
			props: MarkdownCardShape["props"];
	  }
	| {
			id: TLShapeId;
			type: "subwhiteboard-link";
			x: number;
			y: number;
			rotation: number;
			props: SubwhiteboardLinkShape["props"];
	  };

export type ManagedWhiteboardShape = MarkdownCardShape | SubwhiteboardLinkShape;

export type WhiteboardContextMenuValue = {
	createCardAt: ((point: VecLike) => void) | null;
	createSubwhiteboardAt: (point: VecLike) => void;
	pointRef: { current: VecLike | null };
};

export type GlobalCardDeleteShortcutEvent = {
	key: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	repeat: boolean;
};

type TLColorScheme = "light" | "dark" | "system";

// ── Shape ID helpers ──────────────────────────────────────────────────────────

export function toTldrawShapeId(shapeId: string): TLShapeId {
	return (
		shapeId.startsWith("shape:") ? shapeId : `shape:${shapeId}`
	) as TLShapeId;
}

export function bothBindingEndpointsExist(
	editor: Editor,
	binding: unknown,
): boolean {
	if (typeof binding !== "object" || binding === null) return false;
	const { fromId, toId } = binding as { fromId?: unknown; toId?: unknown };
	return (
		typeof fromId === "string" &&
		typeof toId === "string" &&
		editor.getShape(fromId as TLShapeId) !== undefined &&
		editor.getShape(toId as TLShapeId) !== undefined
	);
}

// ── Shape type guards ─────────────────────────────────────────────────────────

export function isManagedWhiteboardShape(
	shape: unknown,
): shape is ManagedWhiteboardShape {
	return (
		typeof shape === "object" &&
		shape !== null &&
		"type" in shape &&
		((shape as { type: string }).type === "markdown-card" ||
			(shape as { type: string }).type === "subwhiteboard-link")
	);
}

export function isSubwhiteboardLinkShape(
	shape: TLShape,
): shape is SubwhiteboardLinkShape {
	return shape.type === "subwhiteboard-link";
}

export function isMarkdownCardShape(
	shape: TLShape,
): shape is MarkdownCardShape {
	return shape.type === "markdown-card";
}

export function isLoadedMarkdownCardShape(
	shape: TLShape,
): shape is MarkdownCardShape {
	return isMarkdownCardShape(shape) && shape.props.contentLoaded === true;
}

// ── Shape hydration ───────────────────────────────────────────────────────────

export function getManagedShapeFrame(shape: ManagedWhiteboardShape) {
	return {
		x: shape.x,
		y: shape.y,
		w: shape.props.w,
		h: shape.props.h,
		rotation: shape.rotation,
		index: (shape as { index?: unknown }).index,
	};
}

export function hasManagedShapeFrameChanged(
	previous: ManagedWhiteboardShape,
	next: ManagedWhiteboardShape,
): boolean {
	const previousFrame = getManagedShapeFrame(previous);
	const nextFrame = getManagedShapeFrame(next);

	return (
		previousFrame.x !== nextFrame.x ||
		previousFrame.y !== nextFrame.y ||
		previousFrame.w !== nextFrame.w ||
		previousFrame.h !== nextFrame.h ||
		previousFrame.rotation !== nextFrame.rotation ||
		previousFrame.index !== nextFrame.index
	);
}

export function itemToShape(
	item: BoardItemResult,
	frame = frameFromItem(item),
): ManagedShapePartial {
	const id = toTldrawShapeId(item.shapeId);

	if (item.kind === "card") {
		return {
			id,
			type: "markdown-card",
			x: frame.x,
			y: frame.y,
			rotation: frame.rotation,
			props: {
				w: frame.w,
				h: getHydratedMarkdownCardHeight({
					serverHeight: frame.h,
					minHeight: 96,
				}),
				content: "",
				cardId: item.cardId ?? undefined,
				title: item.card?.derivedTitle,
				preview: item.card?.preview,
				contentLoaded: false,
				contentVersion: item.card?.version,
			},
		};
	}

	return {
		id,
		type: "subwhiteboard-link",
		x: frame.x,
		y: frame.y,
		rotation: frame.rotation,
		props: {
			w: frame.w,
			h: frame.h,
			label: item.childWhiteboard?.title ?? "Sub-whiteboard",
			subwhiteboardId: item.childWhiteboardId ?? "",
			childWhiteboardId: item.childWhiteboardId ?? undefined,
			depth: item.childWhiteboard?.depth,
		},
	};
}

function managedShapeChanged(
	existing: TLShape,
	next: ManagedShapePartial,
): boolean {
	if (
		existing.x !== next.x ||
		existing.y !== next.y ||
		existing.rotation !== next.rotation
	) {
		return true;
	}

	if (isMarkdownCardShape(existing) && next.type === "markdown-card") {
		return (
			existing.props.w !== next.props.w ||
			existing.props.content !== next.props.content ||
			existing.props.cardId !== next.props.cardId ||
			existing.props.title !== next.props.title ||
			existing.props.preview !== next.props.preview ||
			existing.props.contentLoaded !== next.props.contentLoaded ||
			existing.props.contentVersion !== next.props.contentVersion
		);
	}

	if (
		isSubwhiteboardLinkShape(existing) &&
		next.type === "subwhiteboard-link"
	) {
		return (
			existing.props.w !== next.props.w ||
			existing.props.h !== next.props.h ||
			existing.props.label !== next.props.label ||
			existing.props.childWhiteboardId !== next.props.childWhiteboardId
		);
	}

	return false;
}

function preserveEditingCardContent(
	editor: Editor,
	existingShape: TLShape,
	nextShape: ManagedShapePartial,
): ManagedShapePartial {
	if (
		!isMarkdownCardShape(existingShape) ||
		nextShape.type !== "markdown-card"
	) {
		return nextShape;
	}

	const preserve: { h: number; content?: string } = {
		h: existingShape.props.h,
	};

	if (
		existingShape.props.contentLoaded &&
		existingShape.props.contentVersion === nextShape.props.contentVersion
	) {
		return {
			...nextShape,
			props: {
				...nextShape.props,
				h: existingShape.props.h,
				content: existingShape.props.content,
				contentLoaded: true,
				contentVersion: existingShape.props.contentVersion,
			},
		};
	}

	const cardId = existingShape.props.cardId as Id<"cards"> | undefined;
	const hasUnsavedLocalEdits = Boolean(cardId && isCardContentDirty(cardId));

	if (existingShape.id === editor.getEditingShapeId() || hasUnsavedLocalEdits) {
		return {
			...nextShape,
			props: {
				...nextShape.props,
				h: existingShape.props.h,
				content: existingShape.props.content,
				contentLoaded: existingShape.props.contentLoaded,
				contentVersion: existingShape.props.contentVersion,
			},
		};
	}

	return {
		...nextShape,
		props: { ...nextShape.props, ...preserve },
	};
}

export function rehydrateItemShape(
	editor: Editor,
	item: BoardItemResult,
	frame = frameFromItem(item),
) {
	const nextShape = itemToShape(item, frame);
	const existingShape = editor.getShape(nextShape.id);

	if (existingShape) {
		const updatedShape = preserveEditingCardContent(
			editor,
			existingShape,
			nextShape,
		);
		if (managedShapeChanged(existingShape, updatedShape)) {
			editor.updateShape(updatedShape);
		}
	} else {
		editor.createShape(nextShape);
	}
}

export function hydrateCardShapes(
	editor: Editor,
	payload: {
		cardId: Id<"cards">;
		content: unknown;
		version: number;
	},
) {
	const serializedContent = JSON.stringify(payload.content);
	const updates: ManagedShapePartial[] = [];

	for (const shape of editor.getCurrentPageShapes()) {
		if (!isMarkdownCardShape(shape) || shape.props.cardId !== payload.cardId) {
			continue;
		}

		updates.push({
			id: shape.id,
			type: "markdown-card",
			x: shape.x,
			y: shape.y,
			rotation: shape.rotation,
			props: {
				...shape.props,
				content: serializedContent,
				contentLoaded: true,
				contentVersion: payload.version,
			},
		});
	}

	if (updates.length === 0) return;
	editor.updateShapes(updates);
}

export function hasPersistableDrawingChange(changes: {
	added: Record<string, unknown>;
	updated: Record<string, [unknown, unknown]>;
	removed: Record<string, unknown>;
}) {
	for (const record of Object.values(changes.added)) {
		if (!isManagedWhiteboardShapeRecord(record)) return true;
	}

	for (const [, nextRecord] of Object.values(changes.updated)) {
		if (!isManagedWhiteboardShapeRecord(nextRecord)) return true;
	}

	for (const record of Object.values(changes.removed)) {
		if (!isManagedWhiteboardShapeRecord(record)) return true;
	}

	return false;
}

// ── Navigation helpers ────────────────────────────────────────────────────────

export function openSubwhiteboardShape(
	navigate: ReturnType<typeof useNavigate>,
	shape: TLShape,
) {
	if (!isSubwhiteboardLinkShape(shape)) return;

	const childWhiteboardId = shape.props.childWhiteboardId;
	if (!childWhiteboardId) return;

	void navigate({
		to: "/whiteboard/$whiteboardId",
		params: { whiteboardId: childWhiteboardId },
	});
}

// ── Canvas hit-test helpers ───────────────────────────────────────────────────

export function getWhiteboardDoubleClickShape(
	editor: Editor,
	point: VecLike,
): TLShape | undefined {
	const hoveredShape = editor.getHoveredShape();

	if (hoveredShape && !editor.isShapeOfType(hoveredShape, "group")) {
		return hoveredShape;
	}

	return (
		editor.getSelectedShapeAtPoint(point) ??
		editor.getShapeAtPoint(point, {
			margin: editor.options.hitTestMargin / editor.getZoomLevel(),
			hitInside: true,
			hitLabels: true,
			hitLocked: true,
			hitFrameInside: true,
			renderingOnly: true,
		})
	);
}

export function isPointInCurrentSelection(editor: Editor, point: VecLike) {
	const selectionBounds = editor.getSelectionRotatedPageBounds();

	if (!selectionBounds) return false;

	const selectionRotation = editor.getSelectionRotation();

	if (!selectionRotation) {
		return selectionBounds.containsPoint(point);
	}

	return pointInPolygon(
		point,
		selectionBounds.corners.map((corner) =>
			Vec.RotWith(corner, selectionBounds.point, selectionRotation),
		),
	);
}

// ── Right-drag pan helpers ────────────────────────────────────────────────────

export function hasExceededRightDragPanThreshold({
	startClientX,
	startClientY,
	currentClientX,
	currentClientY,
}: {
	startClientX: number;
	startClientY: number;
	currentClientX: number;
	currentClientY: number;
}) {
	return (
		Math.hypot(currentClientX - startClientX, currentClientY - startClientY) >=
		6
	);
}

export function getRightDragPanNextCamera(
	camera: CameraPosition,
	screenDelta: Pick<VecLike, "x" | "y">,
): CameraPosition {
	return {
		x: camera.x + screenDelta.x / camera.z,
		y: camera.y + screenDelta.y / camera.z,
		z: camera.z,
	};
}

export function syncRightDragPanPointer(
	editor: Pick<Editor, "inputs" | "getViewportScreenBounds" | "screenToPage">,
	point: VecLike,
) {
	const viewportBounds = editor.getViewportScreenBounds();

	editor.inputs.previousScreenPoint.setTo(editor.inputs.currentScreenPoint);
	editor.inputs.previousPagePoint.setTo(editor.inputs.currentPagePoint);

	editor.inputs.currentScreenPoint.set(
		point.x - viewportBounds.x,
		point.y - viewportBounds.y,
	);
	editor.inputs.currentPagePoint.setTo(editor.screenToPage(point));
}

// ── Keyboard shortcut helpers ─────────────────────────────────────────────────

export function isGlobalCardDeleteShortcut(
	event: GlobalCardDeleteShortcutEvent,
) {
	return (
		event.key === "Delete" &&
		event.ctrlKey &&
		!event.altKey &&
		!event.shiftKey &&
		!event.repeat
	);
}

export function collectGlobalDeleteCardIdsFromShapes(
	shapes: TLShape[],
): Id<"cards">[] {
	const cardIds = new Set<Id<"cards">>();

	for (const shape of shapes) {
		if (!isMarkdownCardShape(shape)) continue;

		const cardId = shape.props.cardId;
		if (!cardId) continue;

		cardIds.add(cardId as Id<"cards">);
	}

	return [...cardIds];
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;

	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
		),
	);
}

// ── Theme helpers ─────────────────────────────────────────────────────────────

export function modeToColorScheme(mode: ThemeMode): TLColorScheme {
	return mode === "auto" ? "system" : mode;
}

export function colorSchemeToMode(
	scheme: TLColorScheme | undefined,
): ThemeMode {
	return scheme === "light" || scheme === "dark" ? scheme : "auto";
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export function getWhiteboardKey(
	whiteboardId: Id<"whiteboards"> | null,
): string {
	return whiteboardId ?? "root";
}

// Re-export this so hooks can reference the record type from one place
export type { TLRecord };
