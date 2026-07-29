import { AppSidebarFrame } from "@contextboard/web-ui";
import { Library, Layers } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";

export function DesktopWebSidebar() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	return (
		<AppSidebarFrame
			footer={
				<footer className="mt-auto border-t border-[var(--border)] p-2">
					<div className="flex items-center gap-2 rounded-md px-2 py-1.5">
						<span className="size-2 rounded-full bg-[var(--muted-foreground)]" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-xs font-medium">Desktop</p>
							<p className="truncate text-[10px] text-[var(--muted-foreground)]">
								Local only
							</p>
						</div>
					</div>
				</footer>
			}
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1.5">
				<div className="flex flex-col gap-px">
					<a
						href="#/whiteboard"
						className={[
							"flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-medium outline-none transition-colors",
							pathname.startsWith("/whiteboard")
								? "bg-[var(--accent)] text-[var(--card-foreground)]"
								: "text-[var(--card-foreground)] hover:bg-[var(--accent)]",
						].join(" ")}
					>
						<Layers className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
						<span className="truncate">Root whiteboard</span>
					</a>
					<Link
						to="/cards"
						className={[
							"flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-medium outline-none transition-colors",
							pathname.startsWith("/cards")
								? "bg-[var(--accent)] text-[var(--card-foreground)]"
								: "text-[var(--card-foreground)] hover:bg-[var(--accent)]",
						].join(" ")}
					>
						<Library className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
						<span className="truncate">Card Library</span>
					</Link>
				</div>
			</div>
		</AppSidebarFrame>
	);
}
