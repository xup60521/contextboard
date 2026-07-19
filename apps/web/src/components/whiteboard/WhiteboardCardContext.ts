import { createContext } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The whiteboard a markdown card lives on, so its editor can offer card
 * references scoped to the current board (empty-`@` recent cards). Provided by
 * `WhiteboardCanvas`; null on the root board / when unavailable.
 */
export const WhiteboardCardContext = createContext<Id<"whiteboards"> | null>(
	null,
);
