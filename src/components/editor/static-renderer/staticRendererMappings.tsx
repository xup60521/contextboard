import type { ReactNode } from "react";
import katex from "katex";
import {
	isExternalHref,
	toDataAttribute,
	toSafeHref,
} from "./staticRendererUtils";

type StaticRendererMappingContext = {
	onOpenCardPreview?: (cardId: string) => void;
};

type LinkMarkMappingInput = {
	mark: {
		attrs?: Record<string, unknown>;
	};
	children?: ReactNode;
};

type NodeMappingInput = {
	node: {
		attrs?: Record<string, unknown>;
		type?: { name: string };
		childCount?: number;
	};
	parent?: {
		attrs?: Record<string, unknown>;
	};
	children?: ReactNode;
};

function renderMath(latex: string, displayMode: boolean) {
	const html = katex.renderToString(latex, {
		displayMode: false,
		throwOnError: false,
		strict: false,
	});

	if (displayMode) {
		return (
			<div
				className="tiptap-mathematics-render tiptap-mathematics-render--editable"
				data-type="block-math"
				data-latex={latex}
				contentEditable={false}
			>
				<div
					className="block-math-inner"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</div>
		);
	}

	return (
		<span
			className="tiptap-mathematics-render tiptap-mathematics-render--editable"
			data-type="inline-math"
			data-latex={latex}
			contentEditable={false}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

export function createStaticRendererOptions({
	onOpenCardPreview,
}: StaticRendererMappingContext) {
	return {
		nodeMapping: {
			paragraph({ node, children }: NodeMappingInput) {
				return (
					<p>
						{node.childCount === 0 ? (
							<br className="ProseMirror-trailingBreak" />
						) : (
							children
						)}
					</p>
				);
			},
			image({ node }: NodeMappingInput) {
				const attrs = node.attrs ?? {};
				const src = toDataAttribute(attrs.src);
				const alt = toDataAttribute(attrs.alt);
				const title = toDataAttribute(attrs.title);
				const fileId = toDataAttribute(attrs.fileId);

				return (
					<div
						data-resize-container=""
						data-node="image"
						contentEditable={false}
						draggable={true}
						style={{ display: "flex" }}
					>
						<div
							data-resize-wrapper=""
							style={{ position: "relative", display: "block" }}
						>
							<img
								draggable={false}
								className="editor-image"
								src={src}
								alt={alt}
								title={title}
								data-file-id={fileId}
							/>
							<div
								data-resize-handle="top"
								style={{ position: "absolute", top: 0, left: 0, right: 0 }}
							/>
							<div
								data-resize-handle="bottom"
								style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
							/>
							<div
								data-resize-handle="left"
								style={{ position: "absolute", left: 0, top: 0, bottom: 0 }}
							/>
							<div
								data-resize-handle="right"
								style={{ position: "absolute", right: 0, top: 0, bottom: 0 }}
							/>
						</div>
					</div>
				);
			},
			inlineMath({ node }: NodeMappingInput) {
				return renderMath(toDataAttribute(node.attrs?.latex) ?? "", false);
			},
			blockMath({ node }: NodeMappingInput) {
				return renderMath(toDataAttribute(node.attrs?.latex) ?? "", true);
			},
			details({ node, children }: NodeMappingInput) {
				const isOpen = Boolean(node.attrs?.open);

				return (
					<div
						className={`editor-details${isOpen ? " is-open" : ""}`}
						data-type="details"
					>
						<button
							type="button"
							aria-label={isOpen ? "Collapse dropdown" : "Expand dropdown"}
							data-state={isOpen ? "open" : "closed"}
						/>
						<div>{children}</div>
					</div>
				);
			},
			detailsContent({ parent, children }: NodeMappingInput) {
				const isOpen = Boolean(parent?.attrs?.open);

				return (
					<div
						className="editor-details-content"
						data-type="detailsContent"
						hidden={isOpen ? undefined : true}
					>
						{children}
					</div>
				);
			},
		},

		markMapping: {
			link({ mark, children }: LinkMarkMappingInput) {
				const attrs = mark.attrs ?? {};

				const href = toSafeHref(attrs.href);
				const cardId = toDataAttribute(attrs.cardId);
				const cardLabelMode = toDataAttribute(attrs.cardLabelMode);
				const resolvedTitle = toDataAttribute(attrs.resolvedTitle);
				const external = isExternalHref(href);

				return (
					<a
						href={href}
						data-card-id={cardId}
						data-card-label-mode={cardLabelMode}
						data-resolved-title={resolvedTitle}
						target={external ? "_blank" : undefined}
						rel={external ? "noreferrer" : undefined}
						onClick={(event) => {
							if (!cardId) return;

							event.preventDefault();

							if (event.ctrlKey || event.metaKey) {
								onOpenCardPreview?.(cardId);
							}
						}}
					>
						{children}
					</a>
				);
			},
		},

		unhandledNode({ node }: { node: { type: { name: string } } }) {
			return (
				<span data-unhandled-node-type={node.type.name}>
					[Unhandled node: {node.type.name}]
				</span>
			);
		},

		unhandledMark({ mark }: { mark: { type: { name: string } } }) {
			return (
				<span data-unhandled-mark-type={mark.type.name}>
					[Unhandled mark: {mark.type.name}]
				</span>
			);
		},
	};
}
