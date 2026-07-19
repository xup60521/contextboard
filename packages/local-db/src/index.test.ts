import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import { HybridLogicalClock } from "@contextboard/sync-protocol";
import { ContextboardDatabase, ensureLocalIdentity, runLocalCommand } from "./index";

const databases: ContextboardDatabase[] = [];
const makeDb = () => {
  const db = new ContextboardDatabase(`contextboard-test-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("local database", () => {
  test("creates stable workspace and device identities", async () => {
    const db = makeDb();
    const first = await ensureLocalIdentity(db);
    const second = await ensureLocalIdentity(db);
    expect(second).toEqual(first);
  });

  test("commits domain writes and their change batch atomically", async () => {
    const db = makeDb();
    const identity = await ensureLocalIdentity(db);
    const context = { ...identity, clock: new HybridLogicalClock(identity.deviceId) };
    await runLocalCommand(db, context, "todos.add", [db.todos], async () => {
      const now = Date.now();
      await db.todos.add({ id: "todo-1", text: "Local", completed: false, revision: 1, createdAt: now, updatedAt: now, updatedByDeviceId: identity.deviceId, deletedAt: null });
      return { result: undefined, changes: [{ entityType: "todo", entityId: "todo-1", baseRevision: null, revision: 1, operation: "upsert", changedFields: ["text", "completed"], value: { text: "Local", completed: false } }] };
    });
    expect(await db.todos.count()).toBe(1);
    expect(await db.changeLog.count()).toBe(1);
  });

  test("rolls back both data and log when a command fails", async () => {
    const db = makeDb();
    const identity = await ensureLocalIdentity(db);
    const context = { ...identity, clock: new HybridLogicalClock(identity.deviceId) };
    await expect(runLocalCommand(db, context, "todos.fail", [db.todos], async () => {
      const now = Date.now();
      await db.todos.add({ id: "todo-1", text: "Nope", completed: false, revision: 1, createdAt: now, updatedAt: now, updatedByDeviceId: identity.deviceId, deletedAt: null });
      throw new Error("injected failure");
    })).rejects.toThrow("injected failure");
    expect(await db.todos.count()).toBe(0);
    expect(await db.changeLog.count()).toBe(0);
  });
});
