import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import "./editor.css";

type CardContentPreviewProps = {
	content?: JSONContent | null;
	className?: string;
	contentClassName?: string;
};

type PreviewNode = JSONContent;

type DetailsParts = {
	summary: PreviewNode | null;
	body: PreviewNode | null;
};

export function CardContentPreview({
	content,
	className,
	contentClassName = "min-h-0 bg-transparent text-sm",
}: CardContentPreviewProps) {
	const nodes = getRootNodes(content);

	return (
		<div className={cn(className, "notion-editor seamless")}>
			<div
				className={cn(
					"tiptap prose dark:prose-invert max-w-none focus:outline-none",
					contentClassName,
				)}
			>
				{nodes.length > 0 ? renderNodes(nodes, "preview") : <p />}
			</div>
		</div>
	);
}

function getRootNodes(content: JSONContent | null | undefined): PreviewNode[] {
	if (!content || typeof content !== "object") {
		return [];
	}

	if (content.type === "doc") {
		return normalizeContent(content.content);
	}

	return [content];
}

function normalizeContent(content: JSONContent["content"]): PreviewNode[] {
	return Array.isArray(content) ? content : [];
}

function renderNodes(nodes: PreviewNode[], path: string) {
	return nodes.map((node, index) => renderNode(node, `${path}-${index}`));
}

function renderNode(node: PreviewNode, key: string): ReactNode {
	switch (node.type) {
		case "paragraph":
			return (
				<p key={key}>{renderInlineContent(node.content, `${key}-content`)}</p>
			);
		case "heading": {
			const level = clampHeadingLevel(node.attrs?.level);
			const children = renderInlineContent(node.content, `${key}-content`);
			if (level === 1) return <h1 key={key}>{children}</h1>;
			if (level === 2) return <h2 key={key}>{children}</h2>;
			if (level === 3) return <h3 key={key}>{children}</h3>;
			if (level === 4) return <h4 key={key}>{children}</h4>;
			if (level === 5) return <h5 key={key}>{children}</h5>;
			return <h6 key={key}>{children}</h6>;
		}
		case "bulletList":
			return (
				<ul key={key}>{renderNodes(normalizeContent(node.content), key)}</ul>
			);
		case "orderedList":
			return (
				<ol key={key}>{renderNodes(normalizeContent(node.content), key)}</ol>
			);
		case "listItem":
			return (
				<li key={key}>{renderNodes(normalizeContent(node.content), key)}</li>
			);
		case "blockquote":
			return (
				<blockquote key={key}>
					{renderNodes(normalizeContent(node.content), `${key}-content`)}
				</blockquote>
			);
		case "codeBlock":
			return (
				<pre key={key}>
					<code>{getTextContent(node)}</code>
				</pre>
			);
		case "horizontalRule":
			return <hr key={key} />;
		case "hardBreak":
			return <br key={key} />;
		case "image":
			return (
				<img
					key={key}
					className="editor-image"
					src={String(node.attrs?.src ?? "")}
					alt={String(node.attrs?.alt ?? "")}
					title={String(node.attrs?.title ?? "")}
				/>
			);
		case "inlineMath":
			return (
				<code key={key} data-type="inline-math">
					{`$${String(node.attrs?.latex ?? "")}$`}
				</code>
			);
		case "blockMath":
			return (
				<pre key={key} data-type="block-math">
					<code>{`$$\n${String(node.attrs?.latex ?? "")}\n$$`}</code>
				</pre>
			);
		case "table":
			return (
				<div key={key} className="tableWrapper">
					<table>
						<tbody>{renderNodes(normalizeContent(node.content), key)}</tbody>
					</table>
				</div>
			);
		case "tableRow":
			return (
				<tr key={key}>{renderNodes(normalizeContent(node.content), key)}</tr>
			);
		case "tableHeader":
			return (
				<th key={key}>{renderNodes(normalizeContent(node.content), key)}</th>
			);
		case "tableCell":
			return (
				<td key={key}>{renderNodes(normalizeContent(node.content), key)}</td>
			);
		case "details":
			return renderDetails(node, key);
		case "detailsSummary":
			return (
				<div key={key} className="editor-details-summary">
					{renderInlineContent(node.content, `${key}-content`)}
				</div>
			);
		case "detailsContent":
			return (
				<div key={key} className="editor-details-content">
					{renderNodes(normalizeContent(node.content), `${key}-content`)}
				</div>
			);
		case "text":
			return applyMarks(node, key);
		default: {
			const children = normalizeContent(node.content);
			if (children.length === 0) {
				return null;
			}

			return <div key={key}>{renderNodes(children, `${key}-content`)}</div>;
		}
	}
}

function renderDetails(node: PreviewNode, key: string) {
	const { summary, body } = splitDetailsParts(node);
	const isOpen = node.attrs?.open !== false;

	return (
		<div key={key} data-type="details">
			<button
				type="button"
				aria-hidden="true"
				tabIndex={-1}
				data-state={isOpen ? "open" : "closed"}
			/>
			{summary ? (
				renderNode(summary, `${key}-summary`)
			) : (
				<div className="editor-details-summary">Details</div>
			)}
			{body && isOpen ? renderNode(body, `${key}-body`) : null}
		</div>
	);
}

function splitDetailsParts(node: PreviewNode): DetailsParts {
	const content = normalizeContent(node.content);
	let summary: PreviewNode | null = null;
	let body: PreviewNode | null = null;

	for (const child of content) {
		if (!summary && child.type === "detailsSummary") {
			summary = child;
			continue;
		}
		if (!body && child.type === "detailsContent") {
			body = child;
		}
	}

	return { summary, body };
}

function renderInlineContent(
	content: JSONContent["content"],
	path: string,
): ReactNode {
	const nodes = normalizeContent(content);
	if (nodes.length === 0) {
		return null;
	}

	return nodes.map((node, index) => renderNode(node, `${path}-${index}`));
}

function applyMarks(node: PreviewNode, key: string): ReactNode {
	let content: ReactNode = node.text ?? "";

	for (const [index, mark] of (node.marks ?? []).entries()) {
		const markKey = `${key}-mark-${index}`;
		switch (mark.type) {
			case "bold":
				content = <strong key={markKey}>{content}</strong>;
				break;
			case "italic":
				content = <em key={markKey}>{content}</em>;
				break;
			case "strike":
				content = <s key={markKey}>{content}</s>;
				break;
			case "underline":
				content = <u key={markKey}>{content}</u>;
				break;
			case "code":
				content = <code key={markKey}>{content}</code>;
				break;
			case "link":
				content = (
					<a
						key={markKey}
						href={String(mark.attrs?.href ?? "#")}
						target="_blank"
						rel="noreferrer"
					>
						{content}
					</a>
				);
				break;
			default:
				break;
		}
	}

	return content;
}

function getTextContent(node: PreviewNode): string {
	if (node.text) {
		return node.text;
	}

	return normalizeContent(node.content)
		.map((child) => getTextContent(child))
		.join("");
}

function clampHeadingLevel(level: unknown) {
	if (typeof level !== "number") {
		return 2;
	}

	return Math.min(Math.max(Math.round(level), 1), 6);
}
