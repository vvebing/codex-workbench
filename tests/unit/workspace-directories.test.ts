import { describe, expect, it, vi } from "vitest";
import type { ConnectionStore } from "../../src/features/connection/store";
import { workspaceDirectories } from "../../src/features/shell/workspace-directories";
function fixture() {
  const state = { epoch: 1, scope: 1 };
  const request = vi.fn().mockResolvedValue({
    entries: [{ fileName: "a.ts", isFile: true, isDirectory: false }],
  });
  const connection = {
    getSnapshot: () => state,
    client: { request },
  } as unknown as ConnectionStore;
  return { state, request, connection };
}
describe("workspace directory cache", () => {
  it("shares listings and view state across same-directory mounts without another read", async () => {
    const { connection, request } = fixture();
    const first = workspaceDirectories(connection, "/repo");
    first.query = "a";
    first.expanded.add("src");
    first.scrollTop = 100;
    await first.read("", 0);
    const next = workspaceDirectories(connection, "/repo");
    await next.read("", 0);
    expect(next).toBe(first);
    expect(next.query).toBe("a");
    expect(next.scrollTop).toBe(100);
    expect(request).toHaveBeenCalledTimes(1);
    expect(workspaceDirectories(connection, "/other")).not.toBe(first);
  });
  it("coalesces slow reads and follows an invalidation with at most one read", async () => {
    const { connection, request } = fixture();
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const cache = workspaceDirectories(connection, "/repo");
    const first = cache.read("", 0);
    const duplicate = cache.read("", 0);
    const refresh = cache.read("", 1);
    expect(request).toHaveBeenCalledTimes(1);
    finish({ entries: [] });
    await Promise.all([first, duplicate, refresh]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("retains rows on failure and isolates connection scopes", async () => {
    const { connection, request, state } = fixture();
    const cache = workspaceDirectories(connection, "/repo");
    await cache.read("", 0);
    request.mockRejectedValueOnce(new Error("offline"));
    await cache.read("", 1);
    expect(cache.directories[""].entries?.[0].path).toBe("a.ts");
    expect(cache.directories[""].error).toContain("offline");
    state.scope++;
    expect(workspaceDirectories(connection, "/repo")).not.toBe(cache);
  });
  it("refreshes revisions missed while unmounted without duplicating the first read", async () => {
    const { connection, request } = fixture();
    const cache = workspaceDirectories(connection, "/repo");
    expect(cache.consumeFileRevision(0)).toBe(false);
    await cache.read("", cache.revision);
    expect(cache.consumeFileRevision(0)).toBe(false);
    await cache.read("", cache.revision);
    expect(request).toHaveBeenCalledTimes(1);
    expect(cache.consumeFileRevision(2, ["/other/latest.txt"])).toBe(true);
    await cache.read("", cache.revision);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache.consumeFileRevision(3, ["/other/latest.txt"])).toBe(false);
  });
});
