import { useEffect, useRef } from "react";
import type {
	PastePlacement,
	PendingPasteResolution,
} from "./hooks/usePasteResolution";

export function CardPasteResolutionMenu({
	pending,
	onResolve,
}: {
	pending: PendingPasteResolution;
	onResolve: (placement: PastePlacement) => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const defaultActionRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) {
				onResolve("link");
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onResolve("link");
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onResolve]);

	useEffect(() => {
		defaultActionRef.current?.focus();
	}, []);

	return (
		<div
			ref={menuRef}
			role="menu"
			aria-label="Pasted card options"
			className="animate-in fade-in-0 zoom-in-95 pointer-events-auto absolute z-50 w-[min(18rem,calc(100vw-2rem))] -translate-y-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
			style={{ left: pending.anchor.x, top: pending.anchor.y }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="flex flex-col gap-0.5">
				<button
					ref={defaultActionRef}
					type="button"
					role="menuitem"
					className="flex items-center rounded-sm bg-accent px-2 py-1.5 text-sm font-medium text-accent-foreground outline-hidden transition-colors hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]"
					onClick={() => onResolve("link")}
				>
					Keep linked
				</button>
				<button
					type="button"
					role="menuitem"
					className="flex items-center rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]"
					onClick={() => onResolve("duplicate")}
				>
					Duplicate cards
				</button>
			</div>
		</div>
	);
}
