import type {
	TLComponents,
	TLUiActionsContextType,
	TLUiOverrides,
	TldrawOptions,
} from "tldraw";

const BLOCKED_PAGE_ACTION_IDS = new Set([
	"change-page-prev",
	"change-page-next",
	"move-to-new-page",
]);

export const singlePageTldrawOptions = {
	maxPages: 1,
} satisfies Partial<TldrawOptions>;

export const singlePageTldrawComponents = {
	PageMenu: null,
} satisfies Partial<TLComponents>;

export const singlePageTldrawUiOverrides = {
	actions(_editor, actions) {
		return removeTldrawPageActions(actions);
	},
} satisfies TLUiOverrides;

export function removeTldrawPageActions(
	actions: TLUiActionsContextType,
): TLUiActionsContextType {
	return Object.fromEntries(
		Object.entries(actions).filter(
			([actionId]) => !BLOCKED_PAGE_ACTION_IDS.has(actionId),
		),
	);
}
