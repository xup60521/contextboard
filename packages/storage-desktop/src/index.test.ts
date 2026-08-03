import type { DomainCommand, DomainQuery } from "@contextboard/client-core";
import { describe, expect, test, vi } from "vitest";
import { DesktopWorkspaceRepository } from "./index";

describe("DesktopWorkspaceRepository", () => {
	test("exposes semantic IPC without SQL or filesystem paths", async () => {
		const invoke = vi.fn(async (command: string) => {
			if (command === "workspace_query") return [{ id: "card-1" }];
			if (command === "workspace_execute") return "card-2";
			return null;
		});
		const repository = new DesktopWorkspaceRepository(
			"workspace-1",
			invoke as never,
		);
		const listener = vi.fn();
		repository.subscribe(listener);

		await expect(
			repository.query({
				type: "cards.list",
				input: {},
			} as DomainQuery<Array<{ id: string }>>),
		).resolves.toEqual([{ id: "card-1" }]);
		await expect(
			repository.execute({
				type: "cards.create",
				input: { title: "Desktop" },
			} as DomainCommand<string>),
		).resolves.toBe("card-2");
		expect(listener).toHaveBeenCalledOnce();
		expect(invoke.mock.calls.map(([command]) => command)).toEqual([
			"workspace_query",
			"workspace_execute",
		]);
		expect(JSON.stringify(invoke.mock.calls)).not.toMatch(
			/sql|filesystem|credential/i,
		);
	});

	// A bridge write is another local writer, so it must both repaint and push.
	test("treats a native workspace-changed event as a local write", async () => {
		let fire = () => undefined as void;
		const unsubscribe = vi.fn();
		const listen = vi.fn(async (event: string, handler: () => void) => {
			expect(event).toBe("contextboard://workspace-changed");
			fire = handler;
			return unsubscribe;
		});
		const repository = new DesktopWorkspaceRepository(
			"workspace-1",
			vi.fn() as never,
			listen,
		);
		const changed = vi.fn();
		const local = vi.fn();
		repository.subscribe(changed);
		repository.subscribeLocal(local);

		const stop = await repository.connect();
		fire();
		expect(changed).toHaveBeenCalledOnce();
		expect(local).toHaveBeenCalledOnce();
		stop();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	test("connect is a no-op without a native event source", async () => {
		const repository = new DesktopWorkspaceRepository(
			"workspace-1",
			vi.fn() as never,
		);
		const listener = vi.fn();
		repository.subscribe(listener);
		(await repository.connect())();
		expect(listener).not.toHaveBeenCalled();
	});

	test("transfers content-addressed blobs through the dedicated commands", async () => {
		const descriptor = {
			hash: "a".repeat(64),
			contentType: "image/png",
			size: 3,
		};
		const invoke = vi.fn(async (command: string) => {
			if (command === "workspace_read_blob")
				return { descriptor, bytes: [1, 2, 3] };
			return undefined;
		});
		const repository = new DesktopWorkspaceRepository(
			"workspace-1",
			invoke as never,
		);
		expect((await repository.getLocalBlob(descriptor.hash))?.blob.size).toBe(3);
		await repository.storeRemoteBlob(
			descriptor,
			new Blob([Uint8Array.from([1, 2, 3])]),
		);
		expect(invoke).toHaveBeenLastCalledWith("workspace_store_blob", {
			workspaceId: "workspace-1",
			descriptor,
			bytes: [1, 2, 3],
		});
	});
});
