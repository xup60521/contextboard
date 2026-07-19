import { describe, expect, test, vi } from "vitest";
import { HybridLogicalClock } from "./index";

describe("HybridLogicalClock", () => {
  test("stays monotonic when wall time moves backwards", () => {
    const clock = new HybridLogicalClock("device-a");
    expect(clock.tick(200)).toBe("0000000000200:000000:device-a");
    expect(clock.tick(100)).toBe("0000000000200:000001:device-a");
  });

  test("the local-only transport never attempts network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { LocalOnlyTransport } = await import("./index");
    const transport = new LocalOnlyTransport();
    await expect(transport.pull({ workspaceId: "w", cursor: null, limit: 1 })).rejects.toThrow("not configured");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
