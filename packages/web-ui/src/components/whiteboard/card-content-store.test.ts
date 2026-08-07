import { describe, expect, test, vi } from "vitest";
import { createCardContentStore } from "./card-content-store";

const document = (text: string) => ({
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("CardContentStore", () => {
	test("notifies only subscribers for the changed card", () => {
		const store = createCardContentStore();
		const cardA = vi.fn();
		const cardB = vi.fn();
		store.subscribe("a", cardA);
		store.subscribe("b", cardB);
		store.setPersisted("a", document("A"), 1);
		expect(cardA).toHaveBeenCalledOnce();
		expect(cardB).not.toHaveBeenCalled();
	});

	test("does not replace a dirty draft during hydration", () => {
		const store = createCardContentStore();
		store.setPersisted("a", document("persisted"), 1);
		store.setDraft("a", document("local draft"));
		store.setPersisted("a", document("remote"), 2);
		expect(store.getSnapshot("a")).toMatchObject({
			persistedDocument: document("remote"),
			persistedVersion: 2,
			draft: document("local draft"),
			dirty: true,
		});
	});

	test("acknowledges only the draft represented by the save", () => {
		const store = createCardContentStore();
		store.setPersisted("a", document("initial"), 1);
		store.setDraft("a", document("first edit"));
		store.setDraft("a", document("newer edit"));
		store.acknowledge("a", document("first edit"), 2);
		expect(store.getSnapshot("a")).toMatchObject({
			draft: document("newer edit"),
			dirty: true,
		});
		store.acknowledge("a", document("newer edit"), 3);
		expect(store.getSnapshot("a")).toMatchObject({
			dirty: false,
			persistedVersion: 3,
		});
	});

	test("retains dirty content across save errors", () => {
		const store = createCardContentStore();
		store.setPersisted("a", document("initial"), 1);
		store.setDraft("a", document("draft"));
		store.setError("a", new Error("offline"));
		expect(store.getSnapshot("a")).toMatchObject({
			status: "error",
			draft: document("draft"),
			dirty: true,
		});
	});
});
