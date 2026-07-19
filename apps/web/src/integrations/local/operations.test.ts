import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import { createContextboardDatabase, ensureLocalIdentity, type ContextboardDatabase } from "@contextboard/local-db";
import { localMutation, localQuery } from "./operations";

const databases: ContextboardDatabase[] = [];
async function setup() { const db = createContextboardDatabase(`operations-${crypto.randomUUID()}`); databases.push(db); const identity = await ensureLocalIdentity(db); return { db, ...identity }; }
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.delete())); });

describe("local operations", () => {
  test("creates nested whiteboards and cards with consistent counters", async () => {
    const { db, deviceId } = await setup();
    const root = await localMutation(db, deviceId, "canvas.createSubwhiteboardItem", { parentWhiteboardId: null, shapeId: "shape:root", x: 10, y: 20 });
    const child = await localMutation(db, deviceId, "canvas.createSubwhiteboardItem", { parentWhiteboardId: root.childWhiteboardId, shapeId: "shape:child", x: 30, y: 40 });
    const card = await localMutation(db, deviceId, "canvas.createCardItem", { whiteboardId: child.childWhiteboardId, shapeId: "shape:card", x: 2, y: 3 });
    const board = await db.whiteboards.get(child.childWhiteboardId);
    expect(board).toMatchObject({ parentWhiteboardId: root.childWhiteboardId, depth: 1, cardCount: 1 });
    expect(await localQuery(db, "cards.get", { cardId: card.cardId })).toMatchObject({ _id: card.cardId, activePlacementCount: 1 });
    expect(await db.changeLog.count()).toBe(3);
  });

  test("appends idempotently and archives all active placements", async () => {
    const { db, deviceId } = await setup();
    const first = await localMutation(db, deviceId, "canvas.createSubwhiteboardItem", { parentWhiteboardId: null, shapeId: "shape:a", x: 0, y: 0 });
    const second = await localMutation(db, deviceId, "canvas.createSubwhiteboardItem", { parentWhiteboardId: null, shapeId: "shape:b", x: 0, y: 0 });
    const card = await localMutation(db, deviceId, "canvas.createCardItem", { whiteboardId: first.childWhiteboardId, shapeId: "shape:card", x: 0, y: 0 });
    const placed = await localMutation(db, deviceId, "cards.appendToWhiteboard", { cardId: card.cardId, whiteboardId: second.childWhiteboardId });
    const duplicate = await localMutation(db, deviceId, "cards.appendToWhiteboard", { cardId: card.cardId, whiteboardId: second.childWhiteboardId });
    expect(duplicate.itemId).toBe(placed.itemId);
    await localMutation(db, deviceId, "cards.archiveCard", { cardId: card.cardId });
    expect((await db.boardItems.where("cardId").equals(card.cardId).toArray()).every((item) => item.archivedAt !== null)).toBe(true);
    expect(await localQuery(db, "cards.get", { cardId: card.cardId })).toBeNull();
  });

  test("guards tldraw revisions including the root document", async () => {
    const { db, deviceId } = await setup();
    expect(await localMutation(db, deviceId, "tldrawDocuments.save", { whiteboardId: null, snapshot: { store: {} } })).toMatchObject({ revision: 1 });
    await expect(localMutation(db, deviceId, "tldrawDocuments.save", { whiteboardId: null, snapshot: {}, expectedRevision: 0 })).rejects.toThrow("updated elsewhere");
    expect(await localQuery(db, "tldrawDocuments.get", { whiteboardId: null })).toMatchObject({ revision: 1 });
  });
});
