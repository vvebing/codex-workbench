import { expect, it, vi } from "vitest";
import {
  readLatestRelease,
  ReleaseCheckStore,
} from "../../src/features/connection/release-check";

it.each([200, 404])(
  "falls back to the official API for an old web server (%s)",
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<!doctype html>", {
          status,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          tag_name: "rust-v0.163.0",
          prerelease: false,
          draft: false,
        }),
      );
    expect(await readLatestRelease(fetcher)).toBe("0.163.0");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/openai/codex/releases/latest",
      expect.objectContaining({ credentials: "omit" }),
    );
  },
);
it("uses the new backend directly and reports service errors without fallback", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ version: "0.163.0" }));
  expect(await readLatestRelease(fetcher)).toBe("0.163.0");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(
    Response.json({ error: "unavailable" }, { status: 503 }),
  );
  await expect(readLatestRelease(fetcher)).rejects.toThrow("HTTP 503");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects invalid and prerelease payloads", async () => {
  for (const version of ["bad", "0.164.0-alpha.1", null]) {
    await expect(
      readLatestRelease(
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ version })),
      ),
    ).rejects.toThrow("无效");
  }
});
it("deduplicates connection checks, caches results and allows manual retry", async () => {
  let time = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ version: "0.163.0" }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ version: "0.164.0" }));
  const store = new ReleaseCheckStore(fetcher, () => time);
  const first = store.check();
  expect(store.check()).toBe(first);
  await first;
  await store.check();
  expect(fetcher).toHaveBeenCalledTimes(1);
  time = 300_001;
  await store.check();
  expect(store.getSnapshot()).toMatchObject({
    status: "error",
    latest: null,
    error: "offline",
  });
  await store.check();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await store.check(true);
  expect(store.getSnapshot()).toMatchObject({
    status: "ready",
    latest: "0.164.0",
  });
});
