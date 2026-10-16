import { describe, expect, it, vi } from "vitest";
import { readHistory } from "../../src/features/sessions/history";
import { RpcError, type CodexClient } from "../../src/lib/rpc";
import { placeholderThread } from "../../src/lib/state";

const ephemeral = () => ({
  ...placeholderThread("child"),
  ephemeral: true,
  historyMode: "paginated" as const,
  status: { type: "active" as const, activeFlags: [] },
});
describe("ephemeral history", () => {
  it("reads unknown ephemeral threads without requesting persisted history", async () => {
    const request = vi.fn().mockResolvedValueOnce({ thread: ephemeral() });
    const result = await readHistory(
      { request } as unknown as CodexClient,
      "child",
      undefined,
      () => true,
    );
    expect(result.ephemeral).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith("thread/read", {
      threadId: "child",
      includeTurns: false,
    });
  });
  it("keeps cached live activity and avoids unsupported pagination for known ephemeral metadata", async () => {
    const cached = { ...ephemeral(), turns: [{ id: "live" }] };
    const request = vi.fn();
    const result = await readHistory(
      { request } as unknown as CodexClient,
      "child",
      cached as ReturnType<typeof ephemeral>,
      () => true,
      true,
      ephemeral(),
    );
    expect(result.turns).toBe(cached.turns);
    expect(request).not.toHaveBeenCalled();
  });
  it("propagates missing threads and disconnections without fabricating an empty history", async () => {
    const missing = new RpcError("thread not loaded: child", -32600);
    const request = vi.fn().mockRejectedValue(missing);
    await expect(
      readHistory(
        { request } as unknown as CodexClient,
        "child",
        undefined,
        () => true,
      ),
    ).rejects.toBe(missing);
    expect(request).toHaveBeenCalledTimes(1);
    const disconnect = new Error("Disconnected.");
    request.mockRejectedValue(disconnect);
    await expect(
      readHistory(
        { request } as unknown as CodexClient,
        "child",
        undefined,
        () => true,
      ),
    ).rejects.toBe(disconnect);
    request.mockResolvedValue({ thread: ephemeral() });
    await expect(
      readHistory(
        { request } as unknown as CodexClient,
        "child",
        undefined,
        () => false,
      ),
    ).rejects.toThrow("连接已改变");
  });
  it("does not retry metadata errors as full history reads", async () => {
    const error = new RpcError(
      "ephemeral threads do not support includeTurns",
      -32600,
    );
    const request = vi.fn().mockRejectedValue(error);
    await expect(
      readHistory(
        { request } as unknown as CodexClient,
        "child",
        undefined,
        () => true,
      ),
    ).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
