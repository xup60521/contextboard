import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import { createContextboardDatabase, ensureLocalIdentity, type ContextboardDatabase } from "@contextboard/local-db";
import { exportLocalArchive, importArchive } from "./archive";
import { localMutation } from "./operations";

const databases: ContextboardDatabase[] = [];
const makeDb = async () => { const db = createContextboardDatabase(`archive-${crypto.randomUUID()}`); databases.push(db); return { db, ...(await ensureLocalIdentity(db)) }; };
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.delete())); });

describe("workspace archives", () => {
  test("round trips records without changing workspace identity", async () => {
    const source = await makeDb();
    const board = await localMutation(source.db, source.deviceId, "canvas.createSubwhiteboardItem", { parentWhiteboardId: null, shapeId: "shape:board", x: 1, y: 2 });
    await localMutation(source.db, source.deviceId, "canvas.createCardItem", { whiteboardId: board.childWhiteboardId, shapeId: "shape:card", x: 3, y: 4 });
    const archive = await exportLocalArchive(source.db);
    const target = await makeDb();
    const imported = await importArchive(target.db, await archive.arrayBuffer());
    expect(imported.workspaceId).toBe(source.workspaceId);
    expect(await target.db.cards.count()).toBe(1);
    expect(await target.db.boardItems.count()).toBe(2);
  });

  test("rejects invalid input without replacing current records", async () => {
    const target = await makeDb();
    await target.db.todos.add({ id: "keep", text: "keep", completed: false, revision: 1, createdAt: 1, updatedAt: 1, updatedByDeviceId: target.deviceId, deletedAt: null });
    await expect(importArchive(target.db, new TextEncoder().encode("not zip").buffer)).rejects.toThrow();
    expect(await target.db.todos.get("keep")).toBeTruthy();
  });
});
