export type Id<Entity extends string> = string & {
	readonly __entity?: Entity;
};
