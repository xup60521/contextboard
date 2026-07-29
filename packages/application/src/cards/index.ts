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
export { type ConformanceCase, cardsServiceConformance } from "./conformance";
export {
	type CardEntity,
	createRepositoryCardsService,
} from "./repository-cards-service";
