import { createContext, useContext } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";

export type CardPreviewContextValue = {
	previewCardId: Id<"cards"> | null;
	setPreviewCardId: (id: Id<"cards"> | null) => void;
};

export const CardPreviewContext = createContext<CardPreviewContextValue | null>(
	null,
);

export function useCardPreviewContext(): CardPreviewContextValue {
	const ctx = useContext(CardPreviewContext);
	if (!ctx) {
		throw new Error(
			"useCardPreviewContext must be used within a CardPreviewContext.Provider",
		);
	}
	return ctx;
}
