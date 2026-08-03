declare module "bun:sqlite" {
	export class Database {
		constructor(filename: string);
		run(sql: string, ...parameters: unknown[]): unknown;
		query(sql: string): {
			get(...parameters: unknown[]): unknown;
			all(...parameters: unknown[]): unknown[];
			run(...parameters: unknown[]): unknown;
		};
		close(): void;
	}
}
