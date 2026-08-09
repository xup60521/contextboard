/**
 * Minimal insertion-ordered LRU built on `Map`.
 *
 * Shared by the visible-card-content cache and the per-board data cache so both
 * eviction policies stay identical.
 */
export class LRUCache<T = unknown> {
	private readonly map = new Map<string, T>();

	constructor(private readonly capacity: number) {}

	get(key: string): T | undefined {
		if (!this.map.has(key)) return undefined;
		const value = this.map.get(key) as T;
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	set(key: string, value: T): void {
		if (this.map.has(key)) {
			this.map.delete(key);
		} else if (this.map.size >= this.capacity) {
			this.map.delete(this.map.keys().next().value as string);
		}
		this.map.set(key, value);
	}

	delete(key: string): void {
		this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}
}
