import { atom } from "jotai";

/** The card whose preview dialog the whiteboard currently shows, if any. */
export const whiteboardPreviewCardIdAtom = atom<string | null>(null);
