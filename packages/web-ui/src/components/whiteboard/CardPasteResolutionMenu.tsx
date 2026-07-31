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
			className="pointer-events-auto absolute z-30 w-[min(18rem,calc(100vw-2rem))] -translate-y-1 rounded-xl border border-[var(--lagoon)]/50 border-l-4 border-l-[var(--lagoon)] bg-[var(--card)] p-3 text-[var(--card-foreground)] shadow-[0_18px_48px_rgba(0,0,0,0.2)]"
			style={{ left: pending.anchor.x, top: pending.anchor.y }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="mb-2 text-xs leading-5 text-[var(--muted-foreground)]">
				{pending.cards === 1
					? "This paste can stay linked to the original card."
					: `${pending.cards} pasted cards can stay linked to their originals.`}
			</div>
			<div className="flex gap-2">
				<button
					ref={defaultActionRef}
					type="button"
					role="menuitem"
					className="flex-1 rounded-lg bg-[var(--lagoon)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--lagoon-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon)] focus-visible:ring-offset-2"
					onClick={() => onResolve("link")}
				>
					Keep linked
				</button>
				<button
					type="button"
					role="menuitem"
					className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon)] focus-visible:ring-offset-2"
					onClick={() => onResolve("duplicate")}
				>
					Duplicate cards
				</button>
			</div>
		</div>
	);
}
