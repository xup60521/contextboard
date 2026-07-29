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
