import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const pairs = [
	[
		"apps/web/src/components/whiteboard/AppSidebar.tsx",
		"packages/web-ui/src/components/sidebar/AppSidebar.tsx",
	],
	[
		"apps/web/src/components/sidebar/SidebarTabs.tsx",
		"packages/web-ui/src/components/sidebar/SidebarTabs.tsx",
	],
	[
		"apps/web/src/components/sidebar/SidebarTabRow.tsx",
		"packages/web-ui/src/components/sidebar/SidebarTabRow.tsx",
	],
	[
		"apps/web/src/components/sidebar/ClearOpenTabsDialog.tsx",
		"packages/web-ui/src/components/sidebar/ClearOpenTabsDialog.tsx",
	],
	[
		"apps/web/src/components/whiteboard/ControlledTldrawContextMenu.tsx",
		"packages/web-ui/src/components/whiteboard/ControlledTldrawContextMenu.tsx",
	],
	[
		"apps/web/src/components/whiteboard/CustomMenuPanel.tsx",
		"packages/web-ui/src/components/whiteboard/CustomMenuPanel.tsx",
	],
	[
		"apps/web/src/components/whiteboard/DeleteWhiteboardDialog.tsx",
		"packages/web-ui/src/components/whiteboard/DeleteWhiteboardDialog.tsx",
	],
	[
		"apps/web/src/components/whiteboard/LocalMarkdownCardShape.tsx",
		"packages/web-ui/src/components/whiteboard/LocalMarkdownCardShape.tsx",
	],
	[
		"apps/web/src/components/whiteboard/MarkdownCardShell.tsx",
		"packages/web-ui/src/components/whiteboard/MarkdownCardShell.tsx",
	],
	[
		"apps/web/src/components/whiteboard/PersistedMarkdownCardShape.tsx",
		"packages/web-ui/src/components/whiteboard/PersistedMarkdownCardShape.tsx",
	],
	[
		"apps/web/src/components/whiteboard/SubwhiteboardLinkShape.tsx",
		"packages/web-ui/src/components/whiteboard/SubwhiteboardLinkShape.tsx",
	],
	[
		"apps/web/src/components/whiteboard/TextCardShape.tsx",
		"packages/web-ui/src/components/whiteboard/TextCardShape.tsx",
	],
	[
		"apps/web/src/components/whiteboard/WhiteboardCanvas.tsx",
		"packages/web-ui/src/components/whiteboard/WhiteboardCanvas.tsx",
	],
	[
		"apps/web/src/components/whiteboard/WhiteboardCardPreviewLayer.tsx",
		"packages/web-ui/src/components/whiteboard/WhiteboardCardPreviewLayer.tsx",
	],
	[
		"apps/web/src/components/whiteboard/WhiteboardContextMenu.tsx",
		"packages/web-ui/src/components/whiteboard/WhiteboardContextMenu.tsx",
	],
	[
		"apps/web/src/components/whiteboard/custom-shapes.tsx",
		"packages/web-ui/src/components/whiteboard/custom-shapes.tsx",
	],
	[
		"apps/web/src/components/whiteboard/EditableWhiteboardTitle.tsx",
		"packages/web-ui/src/components/whiteboard/EditableWhiteboardTitle.tsx",
	],
	[
		"apps/web/src/components/search/CardPreviewDialog.tsx",
		"packages/web-ui/src/components/cards/CardPreviewDialog.tsx",
	],
	[
		"apps/web/src/components/editor/CardEditorPane.tsx",
		"packages/web-ui/src/components/editor/CardEditorPane.tsx",
	],
] as const;

function read(relativePath: string) {
	return readFileSync(`${repositoryRoot}/${relativePath}`, "utf8");
}

function uiSignature(source: string) {
	const file = ts.createSourceFile(
		"component.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const signature: string[] = [];
	const tag = (name: ts.JsxTagNameExpression) => {
		const value = name.getText(file);
		return value === "Link" ? "a" : value;
	};
	const visit = (node: ts.Node) => {
		if (ts.isJsxElement(node)) {
			signature.push(`<${tag(node.openingElement.tagName)}>`);
			for (const child of node.children) visit(child);
			signature.push(`</${tag(node.closingElement.tagName)}>`);
			return;
		}
		if (ts.isJsxSelfClosingElement(node)) {
			signature.push(`<${tag(node.tagName)}/>`);
		}
		if (ts.isJsxAttribute(node)) {
			const name = node.name.getText(file);
			if (name === "className" || name === "style") {
				signature.push(`${name}=${node.initializer?.getText(file) ?? ""}`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return signature;
}

describe("exact Web UI fidelity", () => {
	for (const [webPath, sharedPath] of pairs) {
		test(`${sharedPath} keeps Web JSX hierarchy and styling`, () => {
			expect(uiSignature(read(sharedPath))).toEqual(uiSignature(read(webPath)));
		});
	}
});
