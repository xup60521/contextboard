import { expect, test, type Page } from "@playwright/test";

async function storeCount(page: Page, storeName: string) {
	return page.evaluate(
		(name) =>
			new Promise<number>((resolve, reject) => {
				const request = indexedDB.open("contextboard");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const database = request.result;
					const transaction = database.transaction(name, "readonly");
					const count = transaction.objectStore(name).count();
					count.onerror = () => reject(count.error);
					count.onsuccess = () => resolve(count.result);
				};
			}),
		storeName,
	);
}

async function cardsContain(page: Page, value: string) {
	return page.evaluate(
		(expected) =>
			new Promise<boolean>((resolve, reject) => {
				const request = indexedDB.open("contextboard");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const transaction = request.result.transaction("cards", "readonly");
					const rows = transaction.objectStore("cards").getAll();
					rows.onerror = () => reject(rows.error);
					rows.onsuccess = () =>
						resolve(JSON.stringify(rows.result).includes(expected));
				};
			}),
		value,
	);
}

async function firstEntityId(page: Page, storeName: string) {
	return page.evaluate(
		(name) =>
			new Promise<string>((resolve, reject) => {
				const request = indexedDB.open("contextboard");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const transaction = request.result.transaction(name, "readonly");
					const rows = transaction.objectStore(name).getAll();
					rows.onerror = () => reject(rows.error);
					rows.onsuccess = () => resolve(rows.result[0]?.id ?? "");
				};
			}),
		storeName,
	);
}

async function createCard(page: Page) {
	await page.goto("/cards?orphan=&sort=updated&q=");
	await page.getByRole("button", { name: "New card" }).click();
	await expect(page).toHaveURL(/\/cards\/[^/?]+/);
}

test("draw a stroke, reload, and keep the canvas record", async ({ page }) => {
	await page.goto("/whiteboard");
	const canvas = page.locator(".tl-canvas");
	await expect(canvas).toBeVisible();
	let box = await canvas.boundingBox();
	if (!box) throw new Error("Canvas bounds are unavailable");
	await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.75, {
		button: "right",
	});
	await page.getByText("Add whiteboard", { exact: true }).click();
	const whiteboardName = page.getByRole("textbox", { name: "Whiteboard name" });
	await whiteboardName.press("Enter");
	await expect.poll(() => storeCount(page, "whiteboards")).toBeGreaterThan(0);
	const whiteboardId = await firstEntityId(page, "whiteboards");
	await page.goto(`/whiteboard/${whiteboardId}`);
	await expect(page).toHaveURL(/\/whiteboard\/[^/?]+/);
	await page.getByTestId("tools.draw").evaluate((button: HTMLButtonElement) => {
		button.click();
	});
	box = await canvas.boundingBox();
	if (!box) throw new Error("Canvas bounds are unavailable");
	await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
		steps: 8,
	});
	await page.mouse.up();
	await expect.poll(() => storeCount(page, "canvasRecords")).toBeGreaterThan(0);
	const count = await storeCount(page, "canvasRecords");
	await page.reload();
	await expect(canvas).toBeVisible();
	await expect.poll(() => storeCount(page, "canvasRecords")).toBe(count);
});

test("paste an image asset, reload, and retain its file record", async ({ page }) => {
	await createCard(page);
	const editor = page.locator('.ProseMirror[contenteditable="true"]');
	await editor.click();
	await page.keyboard.press("End");
	await page.keyboard.type("/");
	const chooserPromise = page.waitForEvent("filechooser");
	await page.getByText("Upload Image", { exact: true }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: "pixel.png",
		mimeType: "image/png",
		buffer: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nAAAAABJRU5ErkJggg==",
			"base64",
		),
	});
	await expect.poll(() => storeCount(page, "files")).toBeGreaterThan(0);
	await expect.poll(() => cardsContain(page, "contextboard-file:")).toBe(true);
	await page.reload();
	await expect(page.locator(".ProseMirror img")).toBeVisible();
});

test("card text survives reload", async ({ page }) => {
	await createCard(page);
	const editor = page.locator('.ProseMirror[contenteditable="true"]');
	await editor.click();
	await page.keyboard.press("Control+A");
	await page.keyboard.type("Persistent browser card");
	await expect.poll(() => storeCount(page, "cards")).toBeGreaterThan(0);
	await page.locator("main").click({ position: { x: 10, y: 10 } });
	await page.waitForTimeout(700);
	await page.reload();
	await expect(
		page.locator('.ProseMirror[contenteditable="true"]'),
	).toContainText(
		"Persistent browser card",
	);
});

test("card search, sort, and orphan state round-trip through the URL", async ({
	page,
}) => {
	await page.goto("/cards?orphan=&sort=title&q=research");
	await expect(page.getByPlaceholder("Find a card...")).toHaveValue("research");
	await page.getByRole("button", { name: "Orphan only" }).click();
	await expect(page).toHaveURL(/orphan=true/);
	await page.reload();
	await expect(page.getByRole("button", { name: "Orphan only" })).toBeVisible();
	await expect(page).toHaveURL(/sort=updated/);
});
