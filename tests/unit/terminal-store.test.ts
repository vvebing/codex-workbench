import { describe, expect, it, vi } from "vitest";
import {
  TerminalStore,
  TERMINAL_OUTPUT_LIMIT,
  hasLiveTerminals,
  subscribeTerminalActivity,
  terminalsFor,
} from "../../src/features/terminal/store";
import { Store } from "../../src/lib/store";
import { RpcError, type RpcNotification } from "../../src/lib/rpc";
import type { ConnectionStore } from "../../src/features/connection/store";
import { readOnlyTerminalCommand } from "../../src/features/terminal/bootstrap";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
type Result = { exitCode: number; stdout: string; stderr: string };
function fixture(storage = new Map<string, string>()) {
  const listeners = new Set<(message: RpcNotification) => void>();
  const commands = new Map<string, ReturnType<typeof deferred<Result>>>();
  const request = vi.fn((method: string, params: Record<string, unknown>) => {
    if (method === "command/exec") {
      const pending = deferred<Result>();
      commands.set(params.processId as string, pending);
      return pending.promise;
    }
    return Promise.resolve({});
  });
  class Connection extends Store<{
    url: string;
    epoch: number;
    scope: number;
    status: string;
  }> {
    client = {
      request,
      onNotification: (listener: (message: RpcNotification) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    change(patch: Partial<ReturnType<Connection["getSnapshot"]>>) {
      this.update({ ...this.state, ...patch });
    }
  }
  const connection = new Connection({
    url: "ws://fixture:4501",
    epoch: 1,
    scope: 1,
    status: "connected",
  });
  const typedConnection = connection as unknown as ConnectionStore;
  const persisted = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  const store = new TerminalStore(typedConnection, "fixture", persisted);
  const output = (
    id: string,
    bytes: string | Uint8Array,
    stream: "stdout" | "stderr" = "stdout",
    capReached = false,
  ) => {
    const data =
      typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    const encoded = Array.from(data, (byte) => String.fromCharCode(byte)).join(
      "",
    );
    for (const listener of listeners)
      listener({
        method: "command/exec/outputDelta",
        params: {
          processId: id,
          stream,
          deltaBase64: btoa(encoded),
          capReached,
        },
      });
  };
  return {
    store,
    connection,
    typedConnection,
    request,
    commands,
    storage,
    persisted,
    output,
    listeners,
  };
}
function exit(f: ReturnType<typeof fixture>, id: string, code = 0) {
  f.commands.get(id)!.resolve({ exitCode: code, stdout: "", stderr: "" });
}
function prompt(f: ReturnType<typeof fixture>, id: string, event = "idle") {
  const params = f.request.mock.calls.find(
    ([method, params]) => method === "command/exec" && params.processId === id,
  )![1];
  const token = (params.env as Record<string, string>)
    .CODEX_WORKBENCH_TERMINAL_TOKEN;
  return `\u001b]777;codex-workbench;${token};${event}\u0007`;
}

describe("project terminals", () => {
  it("opens the panel without shell execution or querying environment default permissions", () => {
    const f = fixture();
    f.store.reveal("/project/");
    expect(f.store.getSnapshot()).toMatchObject({
      visible: true,
      projectCwd: "/project",
      sessions: [],
    });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.store.getSnapshot()).not.toHaveProperty("permissions");
    f.store.hide();
    expect(f.store.getSnapshot().visible).toBe(false);
  });
  it("runs concurrent shells in their requested directories with an explicit read-only offline policy", async () => {
    const f = fixture();
    const first = f.store.create("/project/", "/project/packages/app", {
      rows: 30,
      cols: 120,
    });
    const second = f.store.create("/other");
    const [a, b] = f.store.getSnapshot().sessions;
    expect(a).toMatchObject({
      cwd: "/project",
      initialCwd: "/project/packages/app",
      status: "starting",
    });
    expect(f.request).toHaveBeenCalledWith(
      "command/exec",
      expect.objectContaining({
        command: readOnlyTerminalCommand(),
        cwd: "/project/packages/app",
        processId: a.id,
        tty: true,
        disableTimeout: true,
        disableOutputCap: true,
        env: expect.objectContaining({
          TERM: "xterm-256color",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          PAGER: "cat",
          HISTFILE: "/dev/null",
        }),
        size: { rows: 30, cols: 120 },
      }),
    );
    const params = f.request.mock.calls.filter(
      ([method]) => method === "command/exec",
    )[0][1];
    expect(params.sandboxPolicy).toEqual({
      type: "readOnly",
      networkAccess: false,
    });
    expect(f.store.getSnapshot().selected).toMatchObject({
      "/project": a.id,
      "/other": b.id,
    });
    f.store.select("/other", a.id);
    expect(f.store.getSnapshot().selected["/other"]).toBe(b.id);
    exit(f, a.id);
    exit(f, b.id);
    await Promise.all([first, second]);
  });
  it("decodes split UTF-8 per stream and bounds retained output with monotonic offsets", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    const bytes = new TextEncoder().encode("你好");
    f.output(id, bytes.subarray(0, 2));
    f.output(id, "stderr", "stderr");
    f.output(id, bytes.subarray(2));
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "running",
      output: "stderr你好",
    });
    f.output(id, "x".repeat(TERMINAL_OUTPUT_LIMIT));
    const session = f.store.getSnapshot().sessions[0];
    expect(session.output).toHaveLength(TERMINAL_OUTPUT_LIMIT);
    expect(session.outputStart).toBe("stderr你好".length);
    expect(session.truncated).toBe(true);
    exit(f, id);
    await pending;
  });
  it("sends exact input bytes, coalesces equal resize dimensions, and waits for confirmed exit", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    await f.store.write(id, "你好\n\u0003");
    const written = f.request.mock.calls.find(
      ([method]) => method === "command/exec/write",
    )![1];
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(written.deltaBase64 as string), (character) =>
          character.charCodeAt(0),
        ),
      ),
    ).toBe("你好\n\u0003");
    await f.store.resize(id, { rows: 50, cols: 90 });
    await f.store.resize(id, { rows: 50, cols: 90 });
    expect(
      f.request.mock.calls.filter(
        ([method]) => method === "command/exec/resize",
      ),
    ).toHaveLength(1);
    await f.store.end(id);
    expect(f.store.getSnapshot().sessions[0].status).toBe("stopping");
    const count = f.request.mock.calls.length;
    await f.store.write(id, "must not send\n");
    f.store.remove(id);
    expect(f.request).toHaveBeenCalledTimes(count);
    expect(f.store.getSnapshot().sessions).toHaveLength(1);
    exit(f, id, 130);
    await pending;
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "exited",
      exitCode: 130,
    });
    f.store.remove(id);
    expect(f.store.getSnapshot().sessions).toEqual([]);
  });
  it("keeps processes when hiding and isolates endpoint and environment state", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    f.output(id, "original output");
    f.store.hide();
    expect(f.store.getSnapshot().sessions[0].status).toBe("running");
    f.connection.change({ url: "ws://other:4501", epoch: 2, scope: 2 });
    expect(f.store.getSnapshot().sessions).toEqual([]);
    f.connection.change({ url: "ws://fixture:4501", epoch: 3, scope: 3 });
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      id,
      status: "unknown",
      output: "original output",
    });
    const other = new TerminalStore(
      f.typedConnection,
      "another-environment",
      f.persisted,
    );
    expect(other.getSnapshot().sessions).toEqual([]);
    exit(f, id);
    await pending;
    expect(f.store.getSnapshot().sessions[0].status).toBe("unknown");
  });
  it("marks disconnected sessions unknown and ignores late output, writes, resize errors and exit", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    const input = deferred<Record<string, never>>();
    f.request.mockImplementationOnce(() => input.promise);
    const writing = f.store.write(id, "git status\n");
    f.connection.change({ status: "disconnected", epoch: 2 });
    f.output(id, "late output");
    input.reject(new Error("late write rejection"));
    await writing;
    exit(f, id);
    await pending;
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "unknown",
      output: "",
    });
    const count = f.request.mock.calls.length;
    await f.store.write(id, "retry\n");
    await f.store.resize(id, { rows: 40, cols: 100 });
    await f.store.end(id);
    expect(f.request).toHaveBeenCalledTimes(count);
    f.connection.change({ status: "connected", epoch: 3 });
    expect(
      f.request.mock.calls.filter(([method]) => method === "command/exec"),
    ).toHaveLength(1);
  });
  it("restores only metadata and never persists output or filled commands", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    f.output(id, "private-token-output");
    f.store.fill("/project", "private-token-command");
    const revision = f.store.getSnapshot().pendingCommand!.revision;
    f.store.consumeCommand(revision - 1);
    expect(f.store.getSnapshot().pendingCommand).toBeDefined();
    f.store.consumeCommand(revision);
    expect(f.store.getSnapshot().pendingCommand).toBeUndefined();
    expect([...f.storage.values()].join("")).not.toContain("private-token");
    const rebuilt = new TerminalStore(
      f.typedConnection,
      "fixture",
      f.persisted,
    );
    expect(rebuilt.getSnapshot().sessions[0]).toMatchObject({
      id,
      status: "unknown",
      output: "",
    });
    expect(rebuilt.getSnapshot().pendingCommand).toBeUndefined();
    exit(f, id);
    await pending;
  });
  it("does not retry unsupported execution", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new RpcError("unsupported", -32601));
    await f.store.create("/project");
    expect(f.store.getSnapshot().sessions[0].status).toBe("unsupported");
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([403, -32602, -32603])(
    "never falls back to a wider policy when read-only execution is rejected (%s)",
    async (code) => {
      const f = fixture();
      f.request.mockRejectedValueOnce(
        new RpcError("read-only execution rejected", code),
      );
      await f.store.create("/project");
      expect(f.request).toHaveBeenCalledTimes(1);
      expect(f.request.mock.calls[0][1].sandboxPolicy).toEqual({
        type: "readOnly",
        networkAccess: false,
      });
      expect(f.store.getSnapshot().sessions[0].error).toContain(
        "read-only execution rejected",
      );
      expect(f.store.getSnapshot().sessions[0].status).toBe(
        code === -32603 ? "unknown" : "failed",
      );
    },
  );
  it("ignores late termination failures after a confirmed process exit", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    const terminating = deferred<Record<string, never>>();
    f.request.mockImplementationOnce(() => terminating.promise);
    const ending = f.store.end(id);
    exit(f, id);
    await pending;
    terminating.reject(new Error("late rejection"));
    await ending;
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "exited",
      exitCode: 0,
    });
    expect(f.store.getSnapshot().sessions[0].error).toBeUndefined();
  });
  it("caches per environment and lets exit guards inspect live sessions without creating stores", async () => {
    const f = fixture();
    expect(hasLiveTerminals(f.typedConnection)).toBe(false);
    const cached = terminalsFor(f.typedConnection, "cached");
    expect(terminalsFor(f.typedConnection, "cached")).toBe(cached);
    const pending = cached.create("/project");
    const id = cached.getSnapshot().sessions[0].id;
    expect(hasLiveTerminals(f.typedConnection)).toBe(true);
    exit(f, id);
    await pending;
    expect(hasLiveTerminals(f.typedConnection)).toBe(false);
    cached.dispose();
    expect(terminalsFor(f.typedConnection, "cached")).not.toBe(cached);
    expect(f.listeners.size).toBe(2);
  });
  it("observes terminal stores created after an exit guard subscribes and releases listeners", async () => {
    const f = fixture();
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalActivity(f.typedConnection, listener);
    const store = terminalsFor(f.typedConnection, "guarded");
    const pending = store.create("/project");
    const id = store.getSnapshot().sessions[0].id;
    expect(listener).toHaveBeenCalled();
    expect(hasLiveTerminals(f.typedConnection)).toBe(true);
    listener.mockClear();
    exit(f, id);
    await pending;
    expect(listener).toHaveBeenCalled();
    expect(hasLiveTerminals(f.typedConnection)).toBe(false);
    unsubscribe();
    listener.mockClear();
    store.remove(id);
    store.dispose();
    expect(listener).not.toHaveBeenCalled();
  });
  it("tracks submitted commands separately from shell lifetime using authenticated prompt evidence", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
    const control = prompt(f, id);
    f.output(id, control.slice(0, 25));
    expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
    f.output(id, `${control.slice(25)}$ `);
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "running",
      activity: "idle",
      background: false,
      output: "$ ",
    });
    await f.store.write(id, "sleep 10\r");
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "running",
      activity: "busy",
      background: false,
    });
    f.output(id, "working\r\n");
    expect(f.store.getSnapshot().sessions[0].activity).toBe("busy");
    f.output(id, prompt(f, id));
    expect(f.store.getSnapshot().sessions[0].activity).toBe("idle");
    await f.store.write(id, "\u0003");
    expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
    f.output(id, prompt(f, id));
    expect(f.store.getSnapshot().sessions[0].activity).toBe("idle");
    exit(f, id);
    await pending;
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "exited",
      activity: "unknown",
    });
  });
  it("distinguishes background jobs and continuation input without guessing from silence", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    f.output(id, prompt(f, id, "background"));
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      activity: "busy",
      background: true,
    });
    await f.store.write(id, "wait\n");
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      activity: "busy",
      background: false,
    });
    f.output(id, `${prompt(f, id)}$ `);
    await f.store.write(id, "printf 'hello\n");
    expect(f.store.getSnapshot().sessions[0].activity).toBe("busy");
    f.output(id, `${prompt(f, id, "input")}> `);
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      activity: "unknown",
      background: false,
    });
    expect(f.store.getSnapshot().sessions[0].output).toBe("$ > ");
    exit(f, id);
    await pending;
  });
  it("retains unknown activity when startup overrides the prompt and rejects other terminals' markers", async () => {
    const f = fixture();
    const first = f.store.create("/project");
    const second = f.store.create("/project");
    const [a, b] = f.store.getSnapshot().sessions;
    f.output(a.id, "user-custom-prompt> ");
    await f.store.write(a.id, "echo hello\n");
    f.output(a.id, "hello\nuser-custom-prompt> ");
    expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
    const foreign = prompt(f, b.id);
    f.output(a.id, foreign);
    expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
    expect(f.store.getSnapshot().sessions[0].output).toContain(foreign);
    f.output(b.id, prompt(f, b.id));
    expect(f.store.getSnapshot().sessions[1].activity).toBe("idle");
    exit(f, a.id);
    exit(f, b.id);
    await Promise.all([first, second]);
  });
  it("preserves newer prompt evidence if a previously submitted input later reports a failure", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    f.output(id, prompt(f, id));
    const write = deferred<Record<string, never>>();
    f.request.mockImplementationOnce(() => write.promise);
    const writing = f.store.write(id, "echo hello\n");
    f.output(id, prompt(f, id));
    write.reject(new Error("late input failure"));
    await writing;
    expect(f.store.getSnapshot().sessions[0].activity).toBe("idle");
    exit(f, id);
    await pending;
  });
  it("does not persist prompt token, activity evidence or background state", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    f.output(id, prompt(f, id, "background"));
    f.store.select("/project", id);
    const persisted = [...f.storage.values()].join("");
    expect(persisted).not.toContain("CODEX_WORKBENCH");
    expect(persisted).not.toContain("activity");
    expect(persisted).not.toContain("background");
    const rebuilt = new TerminalStore(
      f.typedConnection,
      "fixture",
      f.persisted,
    );
    expect(rebuilt.getSnapshot().sessions[0]).toMatchObject({
      activity: "unknown",
      background: false,
    });
    f.connection.change({ epoch: 2 });
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "unknown",
      activity: "unknown",
      background: false,
    });
    exit(f, id);
    await pending;
  });
  it("closes an inactive live terminal only after confirmed exit and preserves the selected tab", async () => {
    const f = fixture();
    const first = f.store.create("/project");
    const second = f.store.create("/project");
    const [a, b] = f.store.getSnapshot().sessions;
    await f.store.close(a.id);
    expect(f.store.getSnapshot().sessions[0].status).toBe("stopping");
    expect(f.store.getSnapshot().selected["/project"]).toBe(b.id);
    // Repeated close during termination does not issue another kill.
    await f.store.close(a.id);
    expect(
      f.request.mock.calls.filter(
        ([method]) => method === "command/exec/terminate",
      ),
    ).toHaveLength(1);
    exit(f, a.id);
    await first;
    expect(f.store.getSnapshot().sessions.map((session) => session.id)).toEqual(
      [b.id],
    );
    expect(f.store.getSnapshot().selected["/project"]).toBe(b.id);
    await f.store.close(b.id);
    exit(f, b.id);
    await second;
    expect(f.store.getSnapshot().sessions).toEqual([]);
    expect(f.store.getSnapshot().selected["/project"]).toBeUndefined();
  });
  it("retains the tab after rejected termination, then accepts a later confirmed exit without removing it", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    f.request.mockRejectedValueOnce(new Error("kill not confirmed"));
    await f.store.close(id);
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "unknown",
      activity: "unknown",
    });
    expect(f.store.getSnapshot().sessions[0].error).toContain(
      "kill not confirmed",
    );
    f.output(id, "still alive\n");
    expect(f.store.getSnapshot().sessions[0].output).toBe("still alive\n");
    const calls = f.request.mock.calls.length;
    await f.store.close(id);
    expect(f.store.getSnapshot().sessions).toHaveLength(1);
    expect(f.request).toHaveBeenCalledTimes(calls);
    exit(f, id);
    await pending;
    expect(f.store.getSnapshot().sessions[0]).toMatchObject({
      status: "exited",
      exitCode: 0,
      error: undefined,
    });
    await f.store.close(id);
    expect(f.store.getSnapshot().sessions).toEqual([]);
  });
  it("retains uncertain tabs when disconnecting during close and never replays termination", async () => {
    const f = fixture();
    const pending = f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    const acknowledgement = deferred<Record<string, never>>();
    f.request.mockImplementationOnce(() => acknowledgement.promise);
    const closing = f.store.close(id);
    f.connection.change({ status: "disconnected", epoch: 2 });
    acknowledgement.resolve({});
    await closing;
    exit(f, id);
    await pending;
    expect(f.store.getSnapshot().sessions[0].status).toBe("unknown");
    f.connection.change({ status: "connected", epoch: 3 });
    await f.store.close(id);
    expect(
      f.request.mock.calls.filter(
        ([method]) => method === "command/exec/terminate",
      ),
    ).toHaveLength(1);
  });
  it("removes failed and exited records without executing another command", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new RpcError("unsupported", -32601));
    await f.store.create("/project");
    const id = f.store.getSnapshot().sessions[0].id;
    await f.store.close(id);
    expect(f.store.getSnapshot().sessions).toEqual([]);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(["combined", "separate", "before-prompt"])(
    "does not expose false idle for multiple queued shell lines (%s)",
    async (mode) => {
      const f = fixture();
      const pending = f.store.create("/project");
      const id = f.store.getSnapshot().sessions[0].id;
      if (mode !== "before-prompt") f.output(id, prompt(f, id));
      if (mode === "separate") {
        await f.store.write(id, "echo first\r");
        await f.store.write(id, "sleep 30\r");
      } else await f.store.write(id, "echo first\nsleep 30\n");
      if (mode === "before-prompt") {
        f.output(id, prompt(f, id));
        expect(f.store.getSnapshot().sessions[0].activity).not.toBe("idle");
      }
      f.output(id, `first\r\n${prompt(f, id)}$ `);
      expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
      f.output(id, "sleep command started\r\n");
      expect(f.store.getSnapshot().sessions[0].activity).toBe("unknown");
      f.output(id, `${prompt(f, id)}$ `);
      expect(f.store.getSnapshot().sessions[0].activity).toBe("idle");
      exit(f, id);
      await pending;
    },
  );
});
