import type { Transaction } from "@tiptap/pm/state";
import type { MathCandidate, MathSelection } from "./RichTextEditor.types";

function clampPosition(pos: number, max: number) {
	return Math.min(Math.max(pos, 0), max);
}

function selectionDistance(candidate: MathCandidate, pos: number) {
	if (pos >= candidate.pos && pos <= candidate.pos + candidate.nodeSize) {
		return 0;
	}

	return Math.min(
		Math.abs(pos - candidate.pos),
		Math.abs(pos - (candidate.pos + candidate.nodeSize)),
	);
}

export function findInsertedMathSelection(
	transaction: Transaction,
): MathSelection | null {
	if (!transaction.docChanged) {
		return null;
	}

	const candidates: MathCandidate[] = [];

	transaction.steps.forEach((step, index) => {
		step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
			const oldSize = oldEnd - oldStart;
			const newSize = newEnd - newStart;

			if (newSize <= 0 || newSize === oldSize) {
				return;
			}

			const laterMapping = transaction.mapping.slice(index + 1);
			const from = clampPosition(
				laterMapping.map(newStart, -1),
				transaction.doc.content.size,
			);
			const to = clampPosition(
				laterMapping.map(newEnd, 1),
				transaction.doc.content.size,
			);

			if (to <= from) {
				return;
			}

			transaction.doc.nodesBetween(from, to, (node, pos) => {
				if (node.type.name === "inlineMath" || node.type.name === "blockMath") {
					candidates.push({
						pos,
						type: node.type.name === "inlineMath" ? "inline" : "block",
						latex: String(node.attrs.latex ?? ""),
						nodeSize: node.nodeSize,
					});
					return false;
				}

				return true;
			});
		});
	});

	if (candidates.length === 0) {
		return null;
	}

	const [closest] = candidates.sort((a, b) => {
		const distanceDifference =
			selectionDistance(a, transaction.selection.from) -
			selectionDistance(b, transaction.selection.from);

		if (distanceDifference !== 0) {
			return distanceDifference;
		}

		return b.pos - a.pos;
	});

	return {
		pos: closest.pos,
		type: closest.type,
		latex: closest.latex,
	};
}
