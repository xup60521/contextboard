/**
 * Platform-neutral entity id. The brand is optional, so a platform that brands
 * its ids strictly can pass them straight into the shared whiteboard UI while
 * this package stays free of any backend's id types.
 */
export type Id<Entity extends string> = string & {
	readonly __entity?: Entity;
};
