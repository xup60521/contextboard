import type { CSSProperties, ReactNode } from "react";

export type AppShellProps = {
	sidebar: ReactNode;
	children: ReactNode;
	status?: ReactNode;
	className?: string;
	contentClassName?: string;
};

const shellStyle: CSSProperties = {
	display: "flex",
	height: "100dvh",
	overflow: "hidden",
	background: "var(--background)",
};

const contentStyle: CSSProperties = {
	minWidth: 0,
	flex: 1,
	overflowY: "auto",
	position: "relative",
};

export function AppShell({
	sidebar,
	children,
	status,
	className,
	contentClassName,
}: AppShellProps) {
	return (
		<div className={className} style={shellStyle}>
			{sidebar}
			<div
				className={contentClassName}
				data-app-scroll-host="true"
				style={contentStyle}
			>
				{status}
				{children}
			</div>
		</div>
	);
}
