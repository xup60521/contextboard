/**
 * Platform-neutral application contract.
 *
 * Nothing in this package may import Dexie, Tauri, rusqlite schema knowledge,
 * app data paths or a Web auth implementation. Platforms compose an
 * {@link ApplicationRuntime} out of narrow, typed capabilities and hand it to
 * the shared UI.
 */

export type CardSortOrder =
	| "updated_desc"
	| "updated_asc"
	| "title"
	| "title_desc";

export type CardSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	version: number;
	activePlacementCount: number;
};

export type CardPlacement = {
	itemId: string;
	whiteboardId: string | null;
	shapeId: string;
	updatedAt: number;
};

export type CardBacklink = {
	cardId: string;
	title: string;
	preview: string;
};

export type WhiteboardBreadcrumb = {
	id: string;
	title: string;
};

export type CardDetail = CardSummary & {
	content: unknown;
	activePlacementCount: number;
	placements: CardPlacement[];
	backlinks: CardBacklink[];
	/**
	 * The placement the "open on whiteboard" affordances should target, and the
	 * navigation metadata derived from it. Mirrors the Web `cards.get` payload
	 * so the shared card detail UI never has to re-derive it.
	 */
	preferredPlacement: CardPlacement | null;
	boardWhiteboardId: string | null;
	shapeId: string | null;
	/** Root-to-leaf trail of the preferred placement's whiteboard. */
	breadcrumbs: WhiteboardBreadcrumb[];
};

export type ListCardsOptions = {
	searchTerm?: string;
	sortBy?: CardSortOrder;
	orphanOnly?: boolean;
};

export type UpdateCardContentInput = {
	cardId: string;
	content: unknown;
	expectedVersion?: number;
};

export type AppendCardPlacement = {
	cardId: string;
	itemId: string;
	shapeId: string;
	whiteboardId: string;
	created: boolean;
};

export type CardSearchResult = {
	id: string;
	title: string;
	preview: string;
	boardWhiteboardId: string | null;
	shapeId: string | null;
};

export type GlobalCardSearchResult = CardSearchResult & {
	kind: "card";
	content: unknown;
};

export type WhiteboardSearchResult = {
	kind: "whiteboard";
	id: string;
	title: string;
	boardWhiteboardId: string | null;
	shapeId: string | null;
};

export type SearchResults = {
	cards: GlobalCardSearchResult[];
	whiteboards: WhiteboardSearchResult[];
};

export interface SearchService {
	search(input: {
		term: string;
		whiteboardId?: string;
		limit?: number;
	}): Promise<SearchResults>;
}

/** The narrow card capability the shared card UI is allowed to depend on. */
export interface CardsService {
	list(options?: ListCardsOptions): Promise<CardSummary[]>;
	get(cardId: string): Promise<CardDetail | null>;
	getMany(cardIds: string[]): Promise<Array<CardDetail | null>>;
	create(input?: { content?: unknown }): Promise<string>;
	updateContent(input: UpdateCardContentInput): Promise<number>;
	delete(cardId: string): Promise<void>;
	deleteMany(cardIds: string[]): Promise<void>;
	appendToWhiteboard(input: {
		cardId: string;
		whiteboardId: string;
	}): Promise<AppendCardPlacement | null>;
	appendManyToWhiteboard(input: {
		cardIds: string[];
		whiteboardId: string;
	}): Promise<AppendCardPlacement[]>;
	search(input: {
		query: string;
		limit?: number;
		excludeCardId?: string;
		/**
		 * Scopes an *empty* query to the cards placed on this board, so the `@`
		 * picker opens on the current board's recent cards. Ignored once the
		 * user types, because search is global.
		 */
		whiteboardId?: string;
	}): Promise<CardSearchResult[]>;
	/** Notifies when the underlying store changed, so views can revalidate. */
	subscribe(listener: () => void): () => void;
}

export type WhiteboardSummary = {
	id: string;
	title: string;
	parentWhiteboardId: string | null;
	ancestorIds: string[];
	depth: number;
	createdAt: number;
	updatedAt: number;
	cardCount: number;
	childWhiteboardCount: number;
};

export type WhiteboardDetail = WhiteboardSummary & {
	breadcrumbs: WhiteboardBreadcrumb[];
};

export type CreateSubwhiteboardResult = {
	itemId: string;
	childWhiteboardId: string;
};

export type WhiteboardArchiveOptions = {
	deleteCards?: boolean;
};

export interface WhiteboardsService {
	list(): Promise<WhiteboardSummary[]>;
	get(id: string): Promise<WhiteboardDetail | null>;
	createRoot(): Promise<string>;
	createSubwhiteboard(input: {
		parentWhiteboardId: string | null;
		shapeId: string;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		rotation?: number;
	}): Promise<CreateSubwhiteboardResult>;
	rename(input: { whiteboardId: string; title: string }): Promise<string>;
	archive(id: string, options?: WhiteboardArchiveOptions): Promise<void>;
	subscribe(listener: () => void): () => void;
}

export type CanvasItemCard = {
	id: string;
	title: string;
	preview: string;
	version: number;
};

export type CanvasItemWhiteboard = {
	id: string;
	title: string;
	depth: number;
	cardCount: number;
	childWhiteboardCount: number;
};

export type CanvasItem = {
	id: string;
	whiteboardId: string | null;
	kind: "card" | "subwhiteboard";
	cardId: string | null;
	childWhiteboardId: string | null;
	shapeId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
	revision: number;
	createdAt: number;
	updatedAt: number;
	card: CanvasItemCard | null;
	childWhiteboard: CanvasItemWhiteboard | null;
};

export type CreateCardItemResult = { itemId: string; cardId: string };

export type TldrawDocument = {
	id: string | null;
	whiteboardId: string | null;
	snapshot: unknown;
	revision: number;
	updatedAt: number;
	/**
	 * Per-record revisions, present once a board has migrated off the legacy
	 * whole-snapshot row. The canvas uses them to recognise the echo of its own
	 * writes instead of re-hydrating over live edits.
	 */
	canvasRecordVersions?: Record<string, number>;
};

export type TldrawSaveResult = { revision: number; updatedAt: number };

/** An incremental tldraw store change, as the canvas emits it. */
export type CanvasRecordDelta = {
	added: unknown[];
	updated: unknown[];
	removed: string[];
};

export type CanvasRecordSaveResult = { versions: Record<string, number> };

export interface CanvasService {
	listItems(whiteboardId: string | null): Promise<CanvasItem[]>;
	createCardItem(input: {
		whiteboardId: string;
		shapeId: string;
		content?: unknown;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		rotation?: number;
	}): Promise<CreateCardItemResult>;
	createSubwhiteboardItem(input: {
		parentWhiteboardId: string | null;
		shapeId: string;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		rotation?: number;
	}): Promise<CreateSubwhiteboardResult>;
	restoreOrAdoptCardItem(input: {
		whiteboardId: string | null;
		shapeId: string;
		sourceCardId?: string | null;
		sourceWorkspaceId?: string | null;
		placement?: "auto" | "link" | "duplicate";
		content?: unknown;
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		rotation?: number;
	}): Promise<string | null>;
	updateItemFrame(input: {
		itemId: string;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
		zIndex: number;
	}): Promise<void>;
	archiveItem(input: { itemId: string; deleteCards?: boolean }): Promise<void>;
	saveDocument(input: {
		whiteboardId: string | null;
		snapshot: unknown;
		expectedRevision?: number;
	}): Promise<TldrawSaveResult>;
	getDocument(whiteboardId: string | null): Promise<TldrawDocument | null>;
	/**
	 * Persists an incremental drawing change and returns the new revision of
	 * every touched record, so the caller can wait for its own echo.
	 */
	applyRecordChanges(
		input: CanvasRecordDelta & { whiteboardId: string | null },
	): Promise<CanvasRecordSaveResult>;
	subscribe(listener: () => void): () => void;
}

export type FileDescriptor = {
	fileId: string;
	name: string;
	contentType: string;
	size: number;
};

/**
 * Blob capability. Web stores blobs in the local database; Desktop stores them
 * through Tauri blob commands. The shared editor only sees this contract.
 */
export interface FileRuntime {
	upload(file: File): Promise<FileDescriptor>;
	read(fileId: string): Promise<Blob | null>;
	resolveUrl(fileId: string): Promise<string | null>;
	releaseUrl(url: string): void;
}

/** Platform navigation, so shared views never import a concrete router. */
export interface NavigationRuntime {
	cardsHref(): string;
	cardHref(cardId: string): string;
	rootWhiteboardHref(): string;
	whiteboardHref(id: string, options?: { focus?: string }): string;

	navigate(href: string): void;
	replace(href: string): void;

	/**
	 * Maps a router href onto the value an `<a href>` needs. Platforms on hash
	 * history must prefix `#`, otherwise a real click leaves the SPA and the
	 * router reloads at `/`. Defaults to the href unchanged.
	 */
	hrefAttribute?(href: string): string;
}

export type SyncRuntimeState =
	| "idle"
	| "syncing"
	| "offline"
	| "local-only"
	| "error"
	| "unavailable";

export interface SyncRuntime {
	state: SyncRuntimeState;
	message?: string;
}

export type ApplicationPlatform = "web" | "desktop";

export interface ApplicationRuntime {
	platform: ApplicationPlatform;
	workspaceId: string;
	cards: CardsService;
	whiteboards?: WhiteboardsService;
	canvas?: CanvasService;
	files?: FileRuntime;
	search?: SearchService;
	navigation: NavigationRuntime;
	sync?: SyncRuntime;
	ui?: {
		onCardContentDirtyChange?: (cardId: string, dirty: boolean) => void;
		resolveScrollHost?: () => HTMLElement | null;
	};
}
