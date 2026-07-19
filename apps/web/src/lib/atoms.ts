import { atom } from "jotai";
import type { Id } from "#/integrations/local/types";

export const whiteboardPreviewCardIdAtom = atom<Id<"cards"> | null>(null);
