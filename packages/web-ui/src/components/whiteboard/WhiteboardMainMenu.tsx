import {
	DefaultMainMenu,
	DefaultMainMenuContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
} from "tldraw";
import { useWhiteboardActions } from "./WhiteboardActionsContext";

export function WhiteboardMainMenu() {
	const actions = useWhiteboardActions();

	return (
		<DefaultMainMenu>
			<DefaultMainMenuContent />
			{actions?.canDelete ? (
				<TldrawUiMenuGroup id="whiteboard-actions">
					<TldrawUiMenuItem
						id="delete-whiteboard"
						label="Delete whiteboard"
						icon="trash"
						readonlyOk={false}
						onSelect={actions.requestDelete}
					/>
				</TldrawUiMenuGroup>
			) : null}
		</DefaultMainMenu>
	);
}
