import { atom, type Editor, type TLShapeId, useValue } from "tldraw";
import { isMarkdownCardShape } from "./whiteboard-canvas-helpers";

const requests = new WeakMap<Editor, ReturnType<typeof createRequests>>();

function createRequests() {
	return atom("cards to fit", new Set<TLShapeId>());
}

function getRequests(editor: Editor) {
	let pending = requests.get(editor);
	if (!pending) {
		pending = createRequests();
		requests.set(editor, pending);
	}
	return pending;
}

function getFitEligibleCards(editor: Editor) {
	return editor
		.getCurrentPageShapes()
		.filter(
			(shape) =>
				isMarkdownCardShape(shape) && !editor.isShapeOrAncestorLocked(shape),
		);
}

function getSelectedFitEligibleCards(
	editor: Editor,
	cards: ReturnType<typeof getFitEligibleCards>,
) {
	const cardIds = new Set(cards.map((shape) => shape.id));
	return editor.getSelectedShapes().filter((shape) => cardIds.has(shape.id));
}

export function getCardsToFit(editor: Editor) {
	const cards = getFitEligibleCards(editor);
	const selectedCards = getSelectedFitEligibleCards(editor, cards);

	if (selectedCards.length === 0 || selectedCards.length === cards.length) {
		return cards;
	}

	const selectedCardIds = new Set(selectedCards.map((shape) => shape.id));
	return cards.filter((shape) => selectedCardIds.has(shape.id));
}

export function getFitCardsLabel(editor: Editor) {
	const cards = getFitEligibleCards(editor);
	const selectedCount = getSelectedFitEligibleCards(editor, cards).length;

	if (selectedCount === 0 || selectedCount === cards.length) {
		return "Fit all cards to content";
	}

	return `Fit ${selectedCount} ${selectedCount === 1 ? "card" : "cards"} to content`;
}

export function fitCardsToContent(editor: Editor) {
	if (editor.getIsReadonly()) return;
	const cards = getCardsToFit(editor);
	if (!cards.length) return;
	editor.markHistoryStoppingPoint("fit cards to content");
	getRequests(editor).set(new Set(cards.map((shape) => shape.id)));
}

export function useCardFitRequested(editor: Editor, shapeId: TLShapeId) {
	return useValue(
		"card fit requested",
		() =>
			getRequests(editor).get().has(shapeId) &&
			!editor.getCulledShapes().has(shapeId),
		[editor, shapeId],
	);
}

export function completeCardFit(editor: Editor, shapeId: TLShapeId) {
	getRequests(editor).update((pending) => {
		const next = new Set(pending);
		next.delete(shapeId);
		return next;
	});
}
