import { describe, expect, test, vi } from "vitest";
import {
	bootstrapDesktop,
	createDesktopRepository,
	invokeDesktop,
} from "./repository";

describe("desktop semantic IPC", () => {
	test("bootstraps through the dedicated command", async () => {
		const invoke = vi.fn(async () => ({
			version: "0.0.0",
			platform: "windows",
			storageAvailable: false,
		}));
		await expect(bootstrapDesktop(invoke)).resolves.toMatchObject({
			storageAvailable: false,
		});
		expect(invoke).toHaveBeenCalledWith("desktop_bootstrap", undefined);
	});

	test("maps repository calls without exposing SQL or paths", async () => {
		const invoke = vi.fn(async () => []);
		const repository = createDesktopRepository("workspace-1", invoke);
		await repository.getPendingBatches(25);
		expect(invoke).toHaveBeenCalledWith("workspace_pending_batches", {
			workspaceId: "workspace-1",
			limit: 25,
		});
		expect(JSON.stringify(invoke.mock.calls)).not.toMatch(
			/sql|filesystem|credential|path/i,
		);
	});

	test("normalizes typed command errors", async () => {
		const invoke = vi.fn(async () => {
			throw {
				code: "STORAGE_NOT_INITIALIZED",
				message: "Desktop storage is not initialized",
			};
		});
		await expect(
			invokeDesktop("workspace_query", {}, invoke),
		).rejects.toMatchObject({
			name: "STORAGE_NOT_INITIALIZED",
			message: "Desktop storage is not initialized",
		});
	});

	test("rejects malformed native bootstrap payloads", async () => {
		const invoke = vi.fn(async () => ({ version: "0.0.0" }));
		await expect(bootstrapDesktop(invoke)).rejects.toThrow(
			"invalid bootstrap response",
		);
	});
});
