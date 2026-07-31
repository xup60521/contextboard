import { createContext, useContext } from "react";

type WhiteboardActionsContextValue = {
	canDelete: boolean;
	requestDelete: () => void;
};

export const WhiteboardActionsContext =
	createContext<WhiteboardActionsContextValue | null>(null);

export function useWhiteboardActions() {
	return useContext(WhiteboardActionsContext);
}
