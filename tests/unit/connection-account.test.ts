import { describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { RpcError, type RpcNotification } from "../../src/lib/rpc";

function setup() {
  const connection = new ConnectionStore();
  const listener = vi.spyOn(connection.client, "request");
  const internals = connection.client as unknown as {
    notifications: Set<(event: RpcNotification) => void>;
  };
  const notify = (event: RpcNotification) =>
    internals.notifications.forEach((callback) => callback(event));
  const statuses = connection.client as unknown as {
    setStatus(status: string): void;
  };
  statuses.setStatus("connected");
  return { connection, listener, notify };
}
const snapshot = {
  ordinaryUsageAllowed: null,
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 50, resetsAt: 1900000000, windowDurationMins: 300 },
  },
  rateLimitsByLimitId: null,
};

describe("account and connection notices", () => {
  it("coalesces rolling updates and discards a snapshot started before them", async () => {
    const { connection, listener, notify } = setup();
    let resolve!: (value: unknown) => void;
    listener.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = connection.loadRateLimits();
    for (let index = 0; index < 3; index++)
      notify({
        method: "account/rateLimits/updated",
        params: { rateLimits: {} },
      } as RpcNotification);
    expect(listener).toHaveBeenCalledTimes(1);
    const fresh = { ...snapshot, ordinaryUsageAllowed: false };
    listener.mockResolvedValueOnce(fresh);
    resolve({ ...snapshot, ordinaryUsageAllowed: true });
    await first;
    await vi.waitFor(() =>
      expect(connection.getSnapshot().rateLimits).toEqual(fresh),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("isolates unsupported rate limits from connection errors", async () => {
    const { connection, listener } = setup();
    listener.mockRejectedValue(new RpcError("Unknown method", -32601));
    await connection.loadRateLimits();
    expect(connection.getSnapshot()).toMatchObject({
      status: "connected",
      error: null,
      rateLimitsStatus: "unsupported",
      rateLimits: null,
    });
  });
  it("ignores stale reads and replies after disconnect", async () => {
    const { connection, listener } = setup();
    let resolve!: (value: unknown) => void;
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = connection.loadRateLimits();
    const coalesced = connection.loadRateLimits();
    expect(listener).toHaveBeenCalledTimes(1);
    resolve(snapshot);
    await Promise.all([first, coalesced]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      connection.getSnapshot().rateLimits?.ordinaryUsageAllowed,
    ).toBeNull();
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.loadRateLimits();
    connection.disconnect();
    resolve(snapshot);
    await pending;
    expect(connection.getSnapshot()).toMatchObject({
      rateLimits: null,
      rateLimitsStatus: "unknown",
    });
  });
  it("refreshes sparse usage pushes and changed accounts", async () => {
    const { connection, listener, notify } = setup();
    listener.mockImplementation(async (...[method]) =>
      method === "account/read" ? { account: { type: "apiKey" } } : snapshot,
    );
    notify({
      method: "account/rateLimits/updated",
      params: { rateLimits: {} },
    } as RpcNotification);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith("account/rateLimits/read", {});
    await vi.waitFor(() =>
      expect(connection.getSnapshot().rateLimitsStatus).toBe("ready"),
    );
    listener.mockClear();
    notify({
      method: "account/updated",
      params: { authMode: null, planType: null },
    });
    await Promise.resolve();
    expect(connection.getSnapshot().account).toBe("API key");
    expect(listener).toHaveBeenCalledWith("account/read", {});
    expect(listener).toHaveBeenCalledWith("account/rateLimits/read", {});
  });
  it("retains the snapshot and timestamp while refreshing", async () => {
    const { connection, listener } = setup();
    listener.mockResolvedValueOnce(snapshot);
    await connection.loadRateLimits();
    const updatedAt = connection.getSnapshot().rateLimitsUpdatedAt;
    let resolve!: (value: unknown) => void;
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.loadRateLimits();
    expect(connection.getSnapshot()).toMatchObject({
      rateLimits: snapshot,
      rateLimitsUpdatedAt: updatedAt,
      rateLimitsStatus: "loading",
    });
    resolve(snapshot);
    await pending;
  });
  it("revalidates a changed account after an older usage request finishes", async () => {
    const { connection, listener, notify } = setup();
    let resolve!: (value: unknown) => void;
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.loadRateLimits();
    listener.mockImplementation(async (...[method]) =>
      method === "account/read" ? { account: { type: "apiKey" } } : snapshot,
    );
    notify({
      method: "account/updated",
      params: { authMode: null, planType: null },
    });
    resolve({ ...snapshot, ordinaryUsageAllowed: false });
    await pending;
    await vi.waitFor(() =>
      expect(connection.getSnapshot().rateLimits).toEqual(snapshot),
    );
    expect(
      listener.mock.calls.filter(
        ([method]) => method === "account/rateLimits/read",
      ),
    ).toHaveLength(2);
  });
  it("keeps a refreshed account when an older read resolves later", async () => {
    const { connection, listener } = setup();
    let resolve!: (value: unknown) => void;
    listener
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({ account: { type: "apiKey" } });
    const old = connection.loadAccount();
    await connection.loadAccount();
    resolve({ account: { type: "chatgpt", email: "stale@example.com" } });
    await old;
    expect(connection.getSnapshot().account).toBe("API key");
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.loadAccount();
    connection.disconnect();
    resolve({ account: { type: "apiKey" } });
    await pending;
    expect(connection.getSnapshot().account).toBe("未连接");
  });
  it("bounds notices, preserves rerouted thread context, and dismisses", () => {
    const { connection, notify } = setup();
    for (let i = 0; i < 22; i++)
      notify({
        method: "warning",
        params: { message: `Warning ${i}`, threadId: null },
      });
    notify({
      method: "model/rerouted",
      params: {
        threadId: "thread-123",
        turnId: "turn",
        fromModel: "old",
        toModel: "new",
        reason: "highRiskCyberActivity",
      },
    } as RpcNotification);
    const notices = connection.getSnapshot().notices;
    expect(notices).toHaveLength(20);
    expect(notices.at(-1)).toMatchObject({
      threadId: "thread-123",
      message: expect.stringContaining("old → new"),
    });
    connection.dismissNotice(notices[0]!.id);
    expect(connection.getSnapshot().notices).toHaveLength(19);
    connection.disconnect();
    expect(connection.getSnapshot().notices).toEqual([]);
  });
});

const creditSnapshot = {
  ...snapshot,
  rateLimitResetCredits: {
    availableCount: 2n,
    credits: [
      {
        id: "credit-1",
        status: "available",
        resetType: "codexRateLimits",
        expiresAt: null,
      },
    ],
  },
};
async function readyReset() {
  const context = setup();
  context.listener.mockImplementation(async (...[method]) =>
    method === "account/read"
      ? {
          account: {
            type: "chatgpt",
            email: "user@example.com",
            planType: "plus",
          },
          requiresOpenaiAuth: true,
        }
      : creditSnapshot,
  );
  await context.connection.loadAccount();
  await context.connection.loadRateLimits();
  return context;
}
describe("reset credit mutation", () => {
  it("preserves account details and auth requirements", async () => {
    const { connection } = await readyReset();
    expect(connection.getSnapshot().accountDetails).toMatchObject({
      requiresOpenaiAuth: true,
      account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
    });
  });
  it("prevents duplicates and refreshes only after the mutation completes", async () => {
    const { connection, listener } = await readyReset();
    let resolve!: (value: unknown) => void;
    listener.mockClear();
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.consumeRateLimitResetCredit("credit-1");
    await connection.consumeRateLimitResetCredit("credit-1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(connection.getSnapshot().rateLimitResetStatus).toBe("consuming");
    resolve({ outcome: "reset" });
    await pending;
    expect(listener.mock.calls.map(([method]) => method)).toEqual([
      "account/rateLimitResetCredit/consume",
      "account/rateLimits/read",
    ]);
    expect(connection.getSnapshot().rateLimitResetOutcome).toBe("reset");
  });
  it("rejects missing detail, unavailable, expired credits and ordinary refreshes", async () => {
    const { connection, listener } = await readyReset();
    for (const credits of [
      null,
      [],
      [
        {
          id: "credit-1",
          status: "redeemed",
          resetType: "codexRateLimits",
          expiresAt: null,
        },
      ],
      [
        {
          id: "credit-1",
          status: "available",
          resetType: "codexRateLimits",
          expiresAt: 1,
        },
      ],
    ]) {
      listener.mockResolvedValueOnce({
        ...creditSnapshot,
        rateLimitResetCredits: { availableCount: 2n, credits },
      });
      await connection.loadRateLimits();
      listener.mockClear();
      await connection.consumeRateLimitResetCredit("credit-1");
      expect(listener).not.toHaveBeenCalled();
    }
    let resolve!: (value: unknown) => void;
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const read = connection.loadRateLimits();
    await connection.consumeRateLimitResetCredit("credit-1");
    expect(listener).toHaveBeenCalledTimes(1);
    resolve(creditSnapshot);
    await read;
  });
  it("supports backend credit selection only when positive count has no detail list", async () => {
    const { connection, listener } = await readyReset();
    const countOnly = {
      ...creditSnapshot,
      rateLimitResetCredits: { availableCount: 2n, credits: null },
    };
    listener.mockResolvedValueOnce(countOnly);
    await connection.loadRateLimits();
    listener.mockClear();
    listener.mockRejectedValueOnce(new Error("Request timed out"));
    listener.mockResolvedValueOnce(countOnly);
    await connection.consumeRateLimitResetCredit();
    const params = listener.mock.calls[0]![1];
    expect(params).toEqual({ idempotencyKey: expect.any(String) });
    expect(connection.getSnapshot()).toMatchObject({
      rateLimitResetOutcome: null,
      rateLimitResetStatus: "error",
    });
    listener.mockResolvedValueOnce({ outcome: "reset" });
    listener.mockResolvedValueOnce(countOnly);
    await connection.consumeRateLimitResetCredit();
    expect(listener.mock.calls[2]![1]).toEqual(params);
    expect(connection.getSnapshot().rateLimitResetOutcome).toBe("reset");
    for (const summary of [
      { availableCount: 2n, credits: [] },
      { availableCount: 0n, credits: null },
      creditSnapshot.rateLimitResetCredits,
    ]) {
      listener.mockResolvedValueOnce({
        ...creditSnapshot,
        rateLimitResetCredits: summary,
      });
      await connection.loadRateLimits();
      listener.mockClear();
      await connection.consumeRateLimitResetCredit();
      expect(listener).not.toHaveBeenCalled();
    }
  });
  it("isolates default and explicit credit idempotency attempts", async () => {
    const { connection, listener } = await readyReset();
    listener.mockRejectedValueOnce(new Error("Request timed out"));
    await connection.consumeRateLimitResetCredit("credit-1");
    const explicitParams = listener.mock.calls[2]![1] as {
      idempotencyKey: string;
    };
    const countOnly = {
      ...creditSnapshot,
      rateLimitResetCredits: { availableCount: 2n, credits: null },
    };
    listener.mockResolvedValueOnce(countOnly);
    await connection.loadRateLimits();
    listener.mockClear();
    listener.mockRejectedValueOnce(new Error("Request timed out"));
    listener.mockResolvedValueOnce(countOnly);
    await connection.consumeRateLimitResetCredit();
    expect(listener.mock.calls[0]![1]).not.toHaveProperty("creditId");
    expect(listener.mock.calls[0]![1]).not.toEqual({
      idempotencyKey: explicitParams.idempotencyKey,
    });
  });
  it("rejects unknown reset types and an authoritative zero count", async () => {
    const { connection, listener } = await readyReset();
    for (const summary of [
      {
        availableCount: 1n,
        credits: [
          {
            id: "credit-1",
            status: "available",
            resetType: "unknown",
            expiresAt: null,
          },
        ],
      },
      { ...creditSnapshot.rateLimitResetCredits, availableCount: 0n },
    ]) {
      listener.mockResolvedValueOnce({
        ...creditSnapshot,
        rateLimitResetCredits: summary,
      });
      await connection.loadRateLimits();
      listener.mockClear();
      await connection.consumeRateLimitResetCredit("credit-1");
      expect(listener).not.toHaveBeenCalled();
    }
  });
  it("keeps an ambiguous failure unsuccessful, refreshes and reuses the attempt key", async () => {
    const { connection, listener } = await readyReset();
    listener.mockClear();
    listener.mockRejectedValueOnce(new Error("Request timed out"));
    await connection.consumeRateLimitResetCredit("credit-1");
    const firstParams = listener.mock.calls[0]![1];
    expect(connection.getSnapshot()).toMatchObject({
      rateLimitResetOutcome: null,
      rateLimitResetStatus: "error",
      rateLimitsStatus: "ready",
    });
    listener.mockResolvedValueOnce({ outcome: "alreadyRedeemed" });
    await connection.consumeRateLimitResetCredit("credit-1");
    expect(listener.mock.calls[2]![1]).toEqual(firstParams);
    expect(connection.getSnapshot().rateLimitResetOutcome).toBe(
      "alreadyRedeemed",
    );
  });
  it("requires a fresh snapshot after a failed mutation and failed refresh", async () => {
    const { connection, listener } = await readyReset();
    listener.mockRejectedValueOnce(new Error("Request timed out"));
    listener.mockRejectedValueOnce(new Error("Snapshot unavailable"));
    await connection.consumeRateLimitResetCredit("credit-1");
    listener.mockClear();
    await connection.consumeRateLimitResetCredit("credit-1");
    expect(listener).not.toHaveBeenCalled();
    expect(connection.getSnapshot()).toMatchObject({
      rateLimitsStatus: "error",
      rateLimitResetOutcome: null,
    });
    await connection.loadRateLimits();
    listener.mockResolvedValueOnce({ outcome: "nothingToReset" });
    await connection.consumeRateLimitResetCredit("credit-1");
    expect(connection.getSnapshot().rateLimitResetOutcome).toBe(
      "nothingToReset",
    );
  });
  it("ignores a completed mutation after disconnect", async () => {
    const { connection, listener } = await readyReset();
    let resolve!: (value: unknown) => void;
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.consumeRateLimitResetCredit("credit-1");
    connection.disconnect();
    listener.mockClear();
    resolve({ outcome: "reset" });
    await pending;
    expect(listener).not.toHaveBeenCalled();
    expect(connection.getSnapshot()).toMatchObject({
      accountDetails: null,
      rateLimitResetOutcome: null,
      rateLimitResetStatus: "idle",
    });
  });
  it("blocks further mutations after unsupported method", async () => {
    const { connection, listener } = await readyReset();
    listener.mockRejectedValueOnce(new RpcError("Unsupported", -32601));
    await connection.consumeRateLimitResetCredit("credit-1");
    listener.mockClear();
    await connection.consumeRateLimitResetCredit("credit-1");
    expect(listener).not.toHaveBeenCalled();
    expect(connection.getSnapshot().rateLimitResetStatus).toBe("unsupported");
  });
  it("ignores a mutation response after the account changes", async () => {
    const { connection, listener, notify } = await readyReset();
    let resolve!: (value: unknown) => void;
    listener.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = connection.consumeRateLimitResetCredit("credit-1");
    notify({
      method: "account/updated",
      params: { authMode: null, planType: null },
    });
    await Promise.resolve();
    resolve({ outcome: "reset" });
    await pending;
    expect(connection.getSnapshot().rateLimitResetOutcome).toBeNull();
    expect(connection.getSnapshot().rateLimitResetStatus).toBe("idle");
  });
});
