import type { JSONContent } from "@tiptap/core";
import {
	createContext,
	type ReactNode,
	useContext,
	useSyncExternalStore,
} from "react";

export type CardContentEntry = {
	status: "idle" | "loading" | "ready" | "error";
	persistedDocument: JSONContent | null;
	persistedSerialized: string | null;
	persistedVersion: number | null;
	draft: JSONContent | null;
	draftSerialized: string | null;
	dirty: boolean;
	error: Error | null;
};

const EMPTY_ENTRY: CardContentEntry = {
	status: "idle",
	persistedDocument: null,
	persistedSerialized: null,
	persistedVersion: null,
	draft: null,
	draftSerialized: null,
	dirty: false,
	error: null,
};

export class CardContentStore {
	readonly #entries = new Map<string, CardContentEntry>();
	readonly #listeners = new Map<string, Set<() => void>>();

	getSnapshot = (cardId: string): CardContentEntry =>
		this.#entries.get(cardId) ?? EMPTY_ENTRY;

	subscribe = (cardId: string, listener: () => void) => {
		const listeners = this.#listeners.get(cardId) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(cardId, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.#listeners.delete(cardId);
		};
	};

	#commit(cardId: string, next: CardContentEntry) {
		this.#entries.set(cardId, next);
		for (const listener of this.#listeners.get(cardId) ?? []) listener();
	}

	markLoading(cardId: string) {
		const current = this.getSnapshot(cardId);
		if (current.status === "ready" || current.status === "loading") return;
		this.#commit(cardId, { ...current, status: "loading", error: null });
	}

	setPersisted(
		cardId: string,
		document: unknown,
		version: number,
		serialized = JSON.stringify(document ?? null),
	) {
		const current = this.getSnapshot(cardId);
		const normalized = (document ?? null) as JSONContent | null;
		this.#commit(cardId, {
			...current,
			status: "ready",
			persistedDocument: normalized,
			persistedSerialized: serialized,
			persistedVersion: version,
			draft: current.dirty ? current.draft : normalized,
			draftSerialized: current.dirty ? current.draftSerialized : serialized,
			error: null,
		});
	}

	setDraft(
		cardId: string,
		document: JSONContent,
		serialized = JSON.stringify(document ?? null),
	) {
		const current = this.getSnapshot(cardId);
		this.#commit(cardId, {
			...current,
			status: "ready",
			draft: document,
			draftSerialized: serialized,
			dirty: serialized !== current.persistedSerialized,
			error: null,
		});
	}

	acknowledge(
		cardId: string,
		document: JSONContent,
		version: number,
		serialized = JSON.stringify(document ?? null),
	) {
		const current = this.getSnapshot(cardId);
		const draftMatches =
			current.draft === null || current.draftSerialized === serialized;
		this.#commit(cardId, {
			...current,
			status: "ready",
			persistedDocument: document,
			persistedSerialized: serialized,
			persistedVersion: version,
			draft: draftMatches ? document : current.draft,
			draftSerialized: draftMatches ? serialized : current.draftSerialized,
			dirty: !draftMatches,
			error: null,
		});
	}

	setError(cardId: string, error: Error) {
		const current = this.getSnapshot(cardId);
		this.#commit(cardId, { ...current, status: "error", error });
	}

	reset() {
		const ids = [...this.#entries.keys()];
		this.#entries.clear();
		for (const id of ids)
			for (const listener of this.#listeners.get(id) ?? []) listener();
	}
}

export function createCardContentStore() {
	return new CardContentStore();
}

const fallbackCardContentStore = new CardContentStore();
const CardContentStoreContext = createContext<CardContentStore>(
	fallbackCardContentStore,
);

export function CardContentStoreProvider({
	store,
	children,
}: {
	store: CardContentStore;
	children: ReactNode;
}) {
	return (
		<CardContentStoreContext.Provider value={store}>
			{children}
		</CardContentStoreContext.Provider>
	);
}

export function useCardContentStore() {
	return useContext(CardContentStoreContext);
}

export function useCardContentEntry(cardId: string): CardContentEntry {
	const store = useCardContentStore();
	return useSyncExternalStore(
		(listener) => store.subscribe(cardId, listener),
		() => store.getSnapshot(cardId),
		() => store.getSnapshot(cardId),
	);
}
