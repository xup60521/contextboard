import type { ComponentPropsWithoutRef } from "react";
import { useWhiteboardNavigation } from "../whiteboard/navigation";

export type AppLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
	href: string;
};

/** A platform-aware in-app link shared by the web and desktop shells. */
export function AppLink({ href, onClick, ...props }: AppLinkProps) {
	const link = useWhiteboardNavigation().linkProps(href);

	return (
		<a
			{...props}
			href={link.href}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) link.onClick(event);
			}}
		/>
	);
}
