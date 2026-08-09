/**
 * Headless card entry point: contract, derivation and the repository-backed
 * capability, with no React or JSX. Storage packages import this so they never
 * need a JSX-enabled TypeScript configuration.
 */
export {
	type CardMetadata,
	cardContentToText,
	DEFAULT_CARD_CONTENT,
	DEFAULT_CARD_TITLE,
	deriveCardMetadata,
	textToCardContent,
} from "./card-content";
export { estimateCardHeight } from "./estimate-card-height";
export {
	CARD_REFERENCE_SCHEME,
	WHITEBOARD_REFERENCE_SCHEME,
	cardContentToTextWithReferences,
	referencedCardIds,
	referencedWhiteboardIds,
	textToCardContentWithReferences,
} from "./card-reference-text";
export { type ConformanceCase, cardsServiceConformance } from "./conformance";
export {
	type CardEntity,
	createRepositoryCardsService,
} from "./repository-cards-service";
