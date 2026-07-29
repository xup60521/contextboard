import type { ReactNode } from "react";
import { useApplicationRuntime } from "../ApplicationRuntimeProvider";
import type { SyncRuntimeState } from "../runtime";

const SYNC_LABEL: Record<SyncRuntimeState, string> = {
	idle: "Synced",
	syncing: "Syncing",
	offline: "Offline",
	"local-only": "Local only",
	error: "Sync error",
	unavailable: "Storage unavailable",
};

export type ApplicationSidebarProps = {
	activeHref?: string;
};

export function ApplicationSidebar({ activeHref }: ApplicationSidebarProps) {
	const runtime = useApplicationRuntime();
	const cardsHref = runtime.navigation.cardsHref();
	const links = [{ href: cardsHref, label: "Cards", glyph: "▤" }];

	return (
		<aside className="cb-sidebar">
			<div className="cb-brand">
				<span aria-hidden="true" className="cb-brand__mark">
					C
				</span>
				<div className="cb-brand__text">
					<strong>Contextboard</strong>
					<span>{runtime.platform === "desktop" ? "Desktop" : "Web"}</span>
				</div>
			</div>
			<nav aria-label="Workspace">
				<ul className="cb-nav">
					{links.map((link) => {
						const current = activeHref?.startsWith(link.href) ?? false;
						return (
							<li key={link.href}>
								<a
									aria-current={current ? "page" : undefined}
									className={
										current
											? "cb-nav__item cb-nav__item--active"
											: "cb-nav__item"
									}
									href={link.href}
									onClick={(event) => {
										if (event.metaKey || event.ctrlKey) return;
										event.preventDefault();
										runtime.navigation.navigate(link.href);
									}}
								>
									<span aria-hidden="true">{link.glyph}</span>
									{link.label}
								</a>
							</li>
						);
					})}
				</ul>
			</nav>
			<p className="cb-sidebar__foot">Local-first workspace</p>
		</aside>
	);
}

export type ApplicationShellProps = {
	children: ReactNode;
	activeHref?: string;
};

export function ApplicationShell({
	children,
	activeHref,
}: ApplicationShellProps) {
	const runtime = useApplicationRuntime();
	const sync = runtime.sync;

	return (
		<div className="cb-shell">
			<ApplicationSidebar activeHref={activeHref} />
			<div className="cb-main" data-app-scroll-host="true">
				{sync ? (
					<header className="cb-status-rail">
						<span
							aria-live="polite"
							className="cb-status"
							data-state={sync.state}
						>
							<span aria-hidden="true" className="cb-status__dot" />
							{sync.message ?? SYNC_LABEL[sync.state]}
						</span>
					</header>
				) : null}
				{children}
			</div>
		</div>
	);
}
