import { describe, expect, it, vi } from "vitest";
import { appServerVersion, hasStableUpdate } from "../../server/codex-version";
import { createReleaseChecker } from "../../server/codex-release";

describe("app-server versions", () => {
  it("uses the runtime version, not the client or terminal version", () => {
    expect(
      appServerVersion(
        "codex_web/0.163.0 (Mac OS; arm64) zed/1.24.2 (codex_web; 0.1.0)",
      ),
    ).toBe("0.163.0");
    for (const value of [
      null,
      {},
      "codex",
      "other/1.2.3",
      "codex_web/dev",
      "codex_web/1.2.3garbage",
    ])
      expect(appServerVersion(value)).toBeNull();
    expect(appServerVersion("codex_web/0.164.0-alpha.2+build")).toBe(
      "0.164.0-alpha.2+build",
    );
  });
  it("compares numeric components and handles prereleases without recommending downgrades", () => {
    expect(hasStableUpdate("0.9.0", "0.10.0")).toBe(true);
    expect(hasStableUpdate("0.163.0-alpha.2", "0.163.0")).toBe(true);
    expect(hasStableUpdate("0.164.0-alpha.2", "0.163.0")).toBe(false);
    expect(hasStableUpdate("0.163.0+custom", "0.163.0")).toBe(false);
    expect(hasStableUpdate("dev", "0.163.0")).toBe(false);
    expect(hasStableUpdate("0.162.0", "0.163.0-alpha.2")).toBe(false);
  });
  it("deduplicates requests, caches stable releases and refreshes after expiry", async () => {
    let now = 1;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "rust-v0.163.0",
          draft: false,
          prerelease: false,
        }),
      ),
    );
    // Each actual fetch has its own response body.
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "rust-v0.163.0",
            draft: false,
            prerelease: false,
          }),
        ),
    );
    const check = createReleaseChecker(fetcher, () => now);
    const [a, b] = await Promise.all([check(), check()]);
    expect(a).toEqual(b);
    expect(a.url).toBe(
      "https://github.com/openai/codex/releases/tag/rust-v0.163.0",
    );
    await check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 300_001;
    await check();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects failed or unexpected releases and permits retry after cooldown", async () => {
    let now = 1;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tag_name: "rust-v0.164.0-alpha.1",
            draft: false,
            prerelease: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tag_name: "rust-v0.163.0",
            draft: false,
            prerelease: false,
          }),
        ),
      );
    const check = createReleaseChecker(fetcher, () => now);
    await expect(check()).rejects.toThrow();
    await expect(check()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 30_001;
    await expect(check()).rejects.toThrow();
    now += 30_001;
    expect((await check()).version).toBe("0.163.0");
  });
});
