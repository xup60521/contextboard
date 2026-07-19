import { atom } from "jotai";
import type { Id } from "../../convex/_generated/dataModel";

export const whiteboardPreviewCardIdAtom = atom<Id<"cards"> | null>(null);
