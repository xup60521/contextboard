import { expect, test, type Page } from "@playwright/test";

async function rows(page: Page, storeName: string) {
	return page.evaluate(
		(name) =>
			new Promise<Record<string, unknown>[]>((resolve, reject) => {
				const request = indexedDB.open("contextboard");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const transaction = request.result.transaction(name, "readonly");
					const result = transaction.objectStore(name).getAll();
					result.onerror = () => reject(result.error);
					result.onsuccess = () => resolve(result.result);
				};
			}),
		storeName,
	);
}

async function ensureSidebarOpen(page: Page) {
	await expect(page.locator(".tl-canvas")).toBeVisible();
	const closeSidebar = page.getByRole("button", { name: "Close sidebar" });
	const closeBox = (await closeSidebar.count())
		? await closeSidebar.boundingBox()
		: null;
	if (!closeBox || closeBox.x < 0) {
		await page.getByRole("button", { name: "Open sidebar" }).click();
	}
}

test("card text can reference a whiteboard and the whiteboard shows the backlink", async ({
	page,
}) => {
	const targetTitle = `Reference target ${Date.now()}`;

	await page.goto("/whiteboard");
	const canvas = page.locator(".tl-canvas");
	await expect(canvas).toBeVisible();
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Canvas bounds are unavailable");
	await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.7, {
		button: "right",
	});
	await page.getByText("Add whiteboard", { exact: true }).click();
	const whiteboardName = page.getByRole("textbox", { name: "Whiteboard name" });
	await whiteboardName.fill(targetTitle);
	await whiteboardName.press("Enter");

	let targetWhiteboardId = "";
	await expect
		.poll(async () => {
			const whiteboards = await rows(page, "whiteboards");
			const target = whiteboards.find((row) => row.title === targetTitle);
			targetWhiteboardId = String(target?.id ?? "");
			return targetWhiteboardId;
		})
		.not.toBe("");

	await page.goto(`/whiteboard/${targetWhiteboardId}`);
	await expect(canvas).toBeVisible();
	const targetCanvasBox = await canvas.boundingBox();
	if (!targetCanvasBox) throw new Error("Target canvas bounds are unavailable");
	await page.mouse.click(
		targetCanvasBox.x + targetCanvasBox.width * 0.65,
		targetCanvasBox.y + targetCanvasBox.height * 0.6,
		{ button: "right" },
	);
	await page.getByText("Add markdown card", { exact: true }).click();
	await expect
		.poll(async () =>
			(await rows(page, "boardItems")).some(
				(row) =>
					row.whiteboardId === targetWhiteboardId &&
					typeof row.cardId === "string",
			),
		)
		.toBe(true);

	await page.goto("/cards?orphan=&sort=updated&q=");
	await page.getByRole("button", { name: "New card", exact: true }).click();
	await expect(page).toHaveURL(/\/cards\/[^/?]+/);
	const sourceCardId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const editor = page.locator('.ProseMirror[contenteditable="true"]');
	await editor.click();
	await page.keyboard.type("@");
	const whiteboardSuggestion = page.locator("button[data-index]", {
		hasText: targetTitle,
	});
	await expect(whiteboardSuggestion).toBeVisible();
	await whiteboardSuggestion.click();

	const reference = editor.locator(
		`a[data-whiteboard-id="${targetWhiteboardId}"]`,
	);
	await expect(reference).toHaveText(targetTitle);
	await expect
		.poll(async () =>
			(await rows(page, "whiteboardReferences")).some(
				(row) =>
					row.sourceCardId === sourceCardId &&
					row.targetWhiteboardId === targetWhiteboardId &&
					!row.deletedAt,
			),
		)
		.toBe(true);

	await reference.click({ modifiers: ["Control"] });
	let preview = page.getByRole("dialog", { name: "Whiteboard preview" });
	await expect(preview.getByText("Read only", { exact: true })).toBeVisible();
	await expect(preview.getByText("New card", { exact: true }).first()).toBeVisible();
	await expect(page.getByTestId("tools.draw")).toHaveCount(0);
	await expect(
		page.getByRole("textbox", { name: "Whiteboard name" }),
	).toHaveCount(0);
	await preview
		.getByRole("button", { name: "Close whiteboard preview" })
		.click();
	await expect(preview).toHaveCount(0);
	await expect(page).toHaveURL(`/cards/${sourceCardId}`);

	await reference.click({ modifiers: ["Control"] });
	preview = page.getByRole("dialog", { name: "Whiteboard preview" });
	await expect(preview).toBeVisible();
	await page.locator("[data-slot='dialog-overlay']").click({
		position: { x: 25, y: 25 },
	});
	await expect(preview).toHaveCount(0);
	await expect(page).toHaveURL(`/cards/${sourceCardId}`);
	await expect(page.getByRole("button", { name: "Open sidebar" })).toBeVisible();

	await reference.click({ modifiers: ["Control"] });
	preview = page.getByRole("dialog", { name: "Whiteboard preview" });
	await preview.getByRole("button", { name: "Open whiteboard" }).click();
	await expect(page).toHaveURL(`/whiteboard/${targetWhiteboardId}`);
	await ensureSidebarOpen(page);
	const backlinksButton = page.locator("button", { hasText: "Backlinks" });
	await backlinksButton.click();
	const backlink = page.locator("a", { hasText: "New card" });
	await expect(backlink).toBeVisible();

	await page.reload();
	await ensureSidebarOpen(page);
	await expect(page.locator("button", { hasText: "Backlinks" })).toBeVisible();
	await page.locator("button", { hasText: "Backlinks" }).click();
	await page.locator("a", { hasText: "New card" }).click();
	await expect(page).toHaveURL(`/cards/${sourceCardId}`);

	const reloadedEditor = page.locator('.ProseMirror[contenteditable="true"]');
	await expect(
		reloadedEditor.locator(
			`a[data-whiteboard-id="${targetWhiteboardId}"]`,
		),
	).toHaveText(targetTitle);
	await reloadedEditor.click();
	await reloadedEditor.press("Control+A");
	await reloadedEditor.press("Control+A");
	await reloadedEditor.press("Backspace");
	await expect
		.poll(async () =>
			(await rows(page, "whiteboardReferences")).some(
				(row) =>
					row.sourceCardId === sourceCardId &&
					row.targetWhiteboardId === targetWhiteboardId &&
					!row.deletedAt,
			),
		)
		.toBe(false);

	await page.goto(`/whiteboard/${targetWhiteboardId}`);
	await ensureSidebarOpen(page);
	await page.locator("button", { hasText: "Backlinks" }).click();
	await expect(page.getByText("No backlinks yet", { exact: true })).toBeVisible();
});
