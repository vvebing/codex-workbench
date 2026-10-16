import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";

const runtimes: ReturnType<typeof createRuntime>[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.connection.disconnect();
  vi.restoreAllMocks();
});

function fixture() {
  const runtime = createRuntime();
  runtimes.push(runtime);
  const client = runtime.connection.client as unknown as {
    setStatus(status: string): void;
  };
  const handshake = vi
    .spyOn(runtime.connection.client, "connect")
    .mockImplementation(async () => client.setStatus("connected"));
  vi.spyOn(runtime.connection.client, "request").mockResolvedValue({
    data: [],
    nextCursor: null,
    account: null,
  });
  const refresh = vi.spyOn(runtime.sessions, "refresh").mockResolvedValue();
  const restore = vi
    .spyOn(runtime.sessions, "restoreSelected")
    .mockResolvedValue();
  return { runtime, client, handshake, refresh, restore };
}

it("reuses an initialized endpoint without reloading models, lists or selected history", async () => {
  const f = fixture();
  await f.runtime.connect("ws://remote:4500", "secret");
  const epoch = f.runtime.connection.getSnapshot().epoch;
  const request = vi.mocked(f.runtime.connection.client.request);
  const requests = request.mock.calls.length;
  await f.runtime.connect("ws://remote:4500/");
  await f.runtime.connect("ws://remote:4500", "secret");
  expect(f.handshake).toHaveBeenCalledTimes(1);
  expect(f.runtime.connection.getSnapshot().epoch).toBe(epoch);
  expect(request).toHaveBeenCalledTimes(requests);
  expect(f.refresh).toHaveBeenCalledTimes(1);
  expect(f.restore).toHaveBeenCalledTimes(1);
  await f.runtime.reconnect();
  expect(f.handshake).toHaveBeenLastCalledWith("ws://remote:4500", "secret");
  expect(f.handshake).toHaveBeenCalledTimes(2);
});

it("reconnects for changed credentials, endpoints and disconnected sockets", async () => {
  const f = fixture();
  await f.runtime.connect("ws://remote:4500", "first");
  await f.runtime.connect("ws://remote:4500", "second");
  await f.runtime.connect("ws://other:4500", "second");
  f.runtime.connection.disconnect();
  await f.runtime.connect("ws://other:4500", "second");
  expect(f.handshake).toHaveBeenCalledTimes(4);
});

it("shares an in-flight connection and initializes session data only once", async () => {
  const f = fixture();
  let release!: () => void;
  f.handshake.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = () => {
          f.client.setStatus("connected");
          resolve();
        };
      }),
  );
  const first = f.runtime.connect("ws://remote:4500", "secret");
  const second = f.runtime.connect("ws://remote:4500/");
  expect(f.handshake).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
  expect(f.refresh).toHaveBeenCalledTimes(1);
  expect(f.restore).toHaveBeenCalledTimes(1);
});
