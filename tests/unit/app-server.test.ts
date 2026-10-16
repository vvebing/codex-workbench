import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), connect: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:net", () => ({ createConnection: mocks.connect }));
import { AppServerTerminal, manageAppServer } from "../../server/app-server";

function fixture() {
  const socket = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    setTimeout: vi.fn(),
  });
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  });
  mocks.connect.mockReturnValue(socket);
  mocks.spawn.mockReturnValue(child);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { socket, child };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("reuses an existing listener and never stops it", async () => {
  const { socket } = fixture();
  const stop = manageAppServer();
  socket.emit("connect");
  await Promise.resolve();
  stop();
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(socket.destroy).toHaveBeenCalled();
});

it("starts Codex on the default endpoint and stops only its child", async () => {
  vi.useFakeTimers();
  const { socket, child } = fixture();
  const stop = manageAppServer();
  socket.emit("error", new Error("ECONNREFUSED"));
  await Promise.resolve();
  expect(mocks.spawn).toHaveBeenCalledWith(
    "codex",
    ["app-server", "--listen", "ws://127.0.0.1:4501"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  stop();
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  child.emit("exit", 0, null);
  await vi.advanceTimersByTimeAsync(3000);
  expect(child.kill).toHaveBeenCalledTimes(1);
});

it("handles a missing Codex executable without an unhandled error", async () => {
  const { socket, child } = fixture();
  manageAppServer();
  socket.emit("error", new Error("ECONNREFUSED"));
  await Promise.resolve();
  child.emit(
    "error",
    Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }),
  );
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("未找到 codex"),
  );
});

it("does not launch a child after shutdown during the port check", async () => {
  const { socket } = fixture();
  const stop = manageAppServer();
  stop();
  socket.emit("timeout");
  await Promise.resolve();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("terminates a child that ignores SIGTERM", async () => {
  vi.useFakeTimers();
  const { socket, child } = fixture();
  const stop = manageAppServer();
  socket.emit("error", new Error("ECONNREFUSED"));
  await Promise.resolve();
  stop();
  await vi.advanceTimersByTimeAsync(3000);
  expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
});

it("retains bounded terminal output and includes missing executable diagnostics", async () => {
  const { socket, child } = fixture();
  const terminal = new AppServerTerminal();
  manageAppServer(terminal);
  socket.emit("error", new Error("ECONNREFUSED"));
  await Promise.resolve();
  expect(terminal.snapshot().output).toContain("$ codex app-server --listen");
  child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
  expect(terminal.snapshot()).toMatchObject({
    status: "unavailable",
    output: expect.stringContaining("未找到 codex"),
  });
  terminal.append("x".repeat(200000));
  expect(terminal.snapshot().output.length).toBe(128 * 1024);
});

it("captures stdout and stderr while forwarding both to the launching terminal", async () => {
  const { socket, child } = fixture();
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  Object.assign(child, { stdout, stderr });
  const forwardOut = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const forwardErr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const terminal = new AppServerTerminal();
  manageAppServer(terminal);
  socket.emit("error", new Error("ECONNREFUSED"));
  await Promise.resolve();
  child.emit("spawn");
  stdout.emit("data", "ready\n");
  stderr.emit("data", "warning\n");
  expect(terminal.snapshot()).toMatchObject({
    status: "running",
    output: expect.stringContaining("ready\nwarning\n"),
  });
  expect(forwardOut).toHaveBeenCalledWith("ready\n");
  expect(forwardErr).toHaveBeenCalledWith("warning\n");
  child.emit("exit", 1, null);
  expect(terminal.snapshot().status).toBe("exited");
});
