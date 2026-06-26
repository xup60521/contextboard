import { FileText } from "lucide-react";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#/lib/utils";
import type { CardReferenceSuggestion } from "./types";

export type CardReferenceListHandle = {
	onKeyDown: (event: KeyboardEvent) => boolean;
};

export type CardReferenceListProps = {
	items: CardReferenceSuggestion[];
	command: (item: CardReferenceSuggestion) => void;
};

export const CardReferenceList = forwardRef<
	CardReferenceListHandle,
	CardReferenceListProps
>(function CardReferenceList({ items, command }, ref) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);

	// Reset selection whenever the filtered list changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset when the items prop identity changes.
	useEffect(() => {
		setSelectedIndex(0);
	}, [items]);

	// Keep the active item scrolled into view.
	useLayoutEffect(() => {
		const active = containerRef.current?.querySelector<HTMLElement>(
			`[data-index="${selectedIndex}"]`,
		);
		active?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	function selectItem(index: number) {
		const item = items[index];
		if (item) {
			command(item);
		}
	}

	useImperativeHandle(ref, () => ({
		onKeyDown: (event) => {
			if (items.length === 0) {
				return false;
			}

			if (event.key === "ArrowUp") {
				setSelectedIndex((index) => (index + items.length - 1) % items.length);
				return true;
			}

			if (event.key === "ArrowDown") {
				setSelectedIndex((index) => (index + 1) % items.length);
				return true;
			}

			if (event.key === "Enter") {
				selectItem(selectedIndex);
				return true;
			}

			return false;
		},
	}));

	return (
		<div
			ref={containerRef}
			className="max-h-80 w-72 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-1.5 shadow-[0_18px_44px_rgba(23,58,64,0.18)] backdrop-blur-md"
		>
			{items.length === 0 ? (
				<div className="px-3 py-2 text-sm text-[var(--sea-ink-soft)]">
					No cards found
				</div>
			) : (
				items.map((item, index) => {
					const isActive = index === selectedIndex;
					return (
						<button
							type="button"
							key={item.id}
							data-index={index}
							data-active={isActive}
							onClick={() => selectItem(index)}
							onMouseEnter={() => setSelectedIndex(index)}
							className={cn(
								"slash-item flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left",
								isActive
									? "text-[var(--sea-ink)]"
									: "text-[var(--sea-ink-soft)]",
							)}
						>
							<span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink)]">
								<FileText className="size-4" />
							</span>
							<span className="min-w-0">
								<span className="block truncate text-sm font-semibold text-[var(--sea-ink)]">
									{item.title || "Untitled card"}
								</span>
								{item.preview ? (
									<span className="block truncate text-xs text-[var(--sea-ink-soft)]">
										{item.preview}
									</span>
								) : null}
							</span>
						</button>
					);
				})
			)}
		</div>
	);
});
