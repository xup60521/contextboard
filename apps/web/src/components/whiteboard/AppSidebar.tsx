import {
	signInWithGitHubPopup,
	signOut,
	useSession,
} from "@contextboard/auth-client";
import { AppSidebar as SharedAppSidebar } from "@contextboard/web-ui";
import { useSyncRuntime } from "../../integrations/sync/provider";

export function AppSidebar() {
	const session = useSession();
	const sync = useSyncRuntime();
	return (
		<SharedAppSidebar
			footer={{
				state: sync.state.state,
				message: sync.state.error,
				account: session.data?.user
					? {
							name: session.data.user.name,
							email: session.data.user.email,
						}
					: undefined,
				pendingCount: sync.state.pendingCount,
				conflictCount: sync.state.conflictCount,
				conflictHref: "/data#conflicts",
				signIn: session.data?.user
					? undefined
					: async () => {
							await signInWithGitHubPopup();
							await session.refetch();
						},
				signOut: session.data?.user
					? async () => {
							await signOut();
						}
					: undefined,
				syncNow: sync.syncNow,
				createWorkspace: sync.createWorkspace,
				workspaceSelectionRequired: sync.state.workspaceSelectionRequired,
			}}
		/>
	);
}
