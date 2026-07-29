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

export type CardDetail = CardSummary & {
	content: unknown;
	activePlacementCount: number;
	placements: CardPlacement[];
	backlinks: CardBacklink[];
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

export type ListCardsOptions = {
	searchTerm?: string;
	sortBy?: CardSortOrder;
};

/** The narrow card capability the shared card UI is allowed to depend on. */
export interface CardsService {
	list(options?: ListCardsOptions): Promise<CardSummary[]>;
	get(cardId: string): Promise<CardDetail | null>;
	create(input?: { content?: unknown }): Promise<string>;
	updateContent(input: {
		cardId: string;
		content: unknown;
		expectedVersion?: number;
	}): Promise<number>;
	delete(cardId: string): Promise<void>;
	/** Notifies when the underlying store changed, so views can revalidate. */
	subscribe(listener: () => void): () => void;
}

/** Platform navigation, so shared views never import a concrete router. */
export interface NavigationRuntime {
	cardsHref(): string;
	cardHref(cardId: string): string;
	navigate(href: string): void;
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

export interface WhiteboardsService {
	list(): Promise<Array<Record<string, unknown> & {
		id: string;
		cardCount: number;
		childWhiteboardCount: number;
	}>>;
}

export interface CanvasService {
	listItems(whiteboardId: string): Promise<Array<Record<string, unknown>>>;
}

export type ApplicationPlatform = "web" | "desktop";

export interface ApplicationRuntime {
	platform: ApplicationPlatform;
	workspaceId: string;
	cards: CardsService;
	whiteboards?: WhiteboardsService;
	canvas?: CanvasService;
	navigation: NavigationRuntime;
	sync?: SyncRuntime;
}
