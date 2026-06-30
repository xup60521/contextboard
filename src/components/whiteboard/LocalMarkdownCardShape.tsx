import { useMemo } from "react";
import { stopEventPropagation, useEditor, useIsEditing } from "tldraw";
import { StaticRichTextRenderer } from "#/components/editor/static-renderer";
import { RichTextEditor } from "../editor/RichTextEditor";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import {
	isEmptyCardContent,
	MarkdownCardOpenLink,
	MarkdownCardShell,
	parseMarkdownContent,
} from "./MarkdownCardShell";
import { useMarkdownCardAutoHeight } from "./useMarkdownCardAutoHeight";

const HEADER_HEIGHT = 28;
const MIN_HEIGHT = 64;

export function LocalMarkdownCardComponent({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const currentContent = useMemo(
		() => parseMarkdownContent(shape.props.content),
		[shape.props.content],
	);
	const staticContent = currentContent;
	const { cardRef, setIsContentReady, latestPropsRef, measureNextHeight } =
		useMarkdownCardAutoHeight({
			shape,
			headerHeight: HEADER_HEIGHT,
			minHeight: MIN_HEIGHT,
			isEditing,
		});
	const selectInitialContent = isEmptyCardContent(currentContent);

	return (
		<MarkdownCardShell
			shape={shape}
			isEditing={isEditing}
			className="h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]"
			contentRef={cardRef}
			contentClassName="w-full"
			header={
				<div
					className="flex items-center justify-end border-b border-[var(--border)] px-2 py-1"
					style={{ pointerEvents: "auto" }}
					onPointerDown={(e) => {
						if (isEditing) stopEventPropagation(e);
					}}
				>
					<MarkdownCardOpenLink
						to="/test/markdown"
						className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
					/>
				</div>
			}
		>
			<div className="px-8 py-8">
				{isEditing ? (
					<RichTextEditor
						editable
						content={currentContent}
						contentClassName="min-h-6"
						placeholder="Type '/' for commands"
						onChange={(value) => {
							const latestProps = latestPropsRef.current;
							const nextHeight = measureNextHeight();

							editor.run(
								() => {
									editor.updateShape<MarkdownCardShape>({
										id: shape.id,
										type: "markdown-card",
										props: {
											...latestProps,
											content: JSON.stringify(value),
											h: nextHeight,
										},
									});
								},
								{ history: "ignore" },
							);
						}}
						onReady={() => setIsContentReady(true)}
						defaultFocusPosition={selectInitialContent ? "start" : "end"}
						selectContentOnFocus={selectInitialContent}
					/>
				) : (
					<StaticRichTextRenderer
						content={staticContent}
						contentClassName="min-h-6"
						onReady={() => setIsContentReady(true)}
					/>
				)}
			</div>
		</MarkdownCardShell>
	);
}
