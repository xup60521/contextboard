export type ResolveMarkdownCardHeightInput = {
	currentHeight: number;
	measuredScrollHeight: number | null;
	headerHeight: number;
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

export function resolveMarkdownCardHeight({
	currentHeight,
	measuredScrollHeight,
	headerHeight,
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

	const nextHeight = Math.max(
		minHeight,
		Math.ceil(measuredScrollHeight) - headerHeight + headerHeight,
	);

	return Math.ceil(nextHeight);
}
