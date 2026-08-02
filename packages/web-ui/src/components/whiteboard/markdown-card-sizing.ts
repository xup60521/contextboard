export type ResolveMarkdownCardHeightInput = {
	currentHeight: number;
	measuredScrollHeight: number | null;
	minHeight: number;
	isContentReady: boolean;
	isVisible: boolean;
};

export function getHydratedMarkdownCardHeight({
	serverHeight,
	minHeight,
}: {
	serverHeight: number;
	minHeight: number;
}) {
	return Math.max(minHeight, serverHeight);
}

/**
 * The measured element is the shell's content wrapper, which already contains
 * the card header — so the header needs no separate allowance here.
 */
export function resolveMarkdownCardHeight({
	currentHeight,
	measuredScrollHeight,
	minHeight,
	isContentReady,
	isVisible,
}: ResolveMarkdownCardHeightInput) {
	if (
		!isContentReady ||
		!isVisible ||
		measuredScrollHeight === null ||
		!Number.isFinite(measuredScrollHeight)
	) {
		return currentHeight;
	}

	return Math.max(minHeight, Math.ceil(measuredScrollHeight));
}
