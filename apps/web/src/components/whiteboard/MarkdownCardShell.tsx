import { Link, type LinkProps } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { ExternalLink } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { HTMLContainer, stopEventPropagation, useEditor } from "tldraw";
import type { Id } from "#/integrations/local/types";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import { getShapeContainerStyle } from "./MarkdownCardShapeTypes";

export function parseMarkdownContent(content: string): JSONContent | null {
	if (!content) return null;

	try {
		return JSON.parse(content) as JSONContent;
	} catch {
		return null;
	}
}

export function isEmptyCardContent(content: JSONContent | null): boolean {
	if (!content || content.type !== "doc" || !content.content) return false;
	if (content.content.length !== 1) return false;
	const heading = content.content[0];
	if (heading.type !== "heading" || heading.attrs?.level !== 1) return false;
	if (!heading.content || heading.content.length !== 1) return false;
	const textNode = heading.content[0];
	return textNode.type === "text" && textNode.text === "New card";
}

export function MarkdownCardOpenLink({
	to,
	params,
	ariaLabel,
	className = "absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
}: {
	to: LinkProps["to"];
	params?: LinkProps["params"];
	ariaLabel?: string;
	className?: string;
}) {
	return (
		<Link
			to={to}
			params={params}
			draggable={false}
			onPointerDown={(e) => {
				stopEventPropagation(e);
				e.stopPropagation();
			}}
			onPointerUp={(e) => {
				stopEventPropagation(e);
				e.stopPropagation();
			}}
			onClick={(e) => {
				stopEventPropagation(e);
				e.stopPropagation();
			}}
			className={className}
			style={{ pointerEvents: "auto" }}
			aria-label={ariaLabel}
		>
			<ExternalLink className="size-3.5" />
		</Link>
	);
}

export function MarkdownCardSummaryShell({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const cardId = shape.props.cardId as Id<"cards">;
	const hasSummary = Boolean(shape.props.title || shape.props.preview);

	return (
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
			<div className="relative h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm">
				<MarkdownCardOpenLink
					to="/cards/$cardId"
					params={{ cardId }}
					ariaLabel="Open card editor"
				/>
				<div className="flex h-full flex-col px-8 py-8">
					<div className="mb-3 inline-flex w-fit rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
						Loading card
					</div>
					{hasSummary ? (
						<>
							<div className="text-base font-semibold leading-6">
								{shape.props.title || "Untitled card"}
							</div>
							<div className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-foreground)]">
								{shape.props.preview || "No preview yet."}
							</div>
						</>
					) : (
						<>
							<div className="text-base font-semibold leading-6">
								Card content
							</div>
							<div className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
								Content loads when the card enters view.
							</div>
						</>
					)}
				</div>
			</div>
		</HTMLContainer>
	);
}

export function MarkdownCardShell({
	shape,
	isEditing,
	children,
	header,
	className = "relative h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]",
	contentRef,
	contentClassName,
	onEscape,
}: {
	shape: MarkdownCardShape;
	isEditing: boolean;
	children: ReactNode;
	header?: ReactNode;
	className?: string;
	contentRef?: Ref<HTMLDivElement>;
	contentClassName?: string;
	onEscape?: () => void;
}) {
	const editor = useEditor();

	return (
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
			{/** biome-ignore lint/a11y/noStaticElementInteractions: tldraw shapes guard pointer/keyboard events here. */}
			<div
				className={className}
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onPointerUp={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onClick={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onDoubleClick={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onKeyDown={(e) => {
					if (!isEditing) return;
					stopEventPropagation(e);

					if (e.key === "Escape") {
						if (onEscape) {
							onEscape();
						} else {
							editor.setEditingShape(null);
						}
					}
				}}
				onPaste={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onWheel={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
			>
				<div ref={contentRef} className={contentClassName}>
					{header}
					{children}
				</div>
			</div>
		</HTMLContainer>
	);
}
