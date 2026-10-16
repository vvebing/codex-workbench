import { expect, it, vi } from "vitest";
import { EnvironmentsStore } from "../../src/features/connection/environments";
import {
  SessionUrlStore,
  readSessionUrl,
  writeSessionUrl,
} from "../../src/features/navigation/session-url";

function setup(href: string) {
  let url = new URL(href);
  const listeners = new Map<string, () => void>();
  const history = {
    pushState: vi.fn((_state: unknown, _title: string, next: URL) => {
      url = new URL(next);
    }),
    replaceState: vi.fn((_state: unknown, _title: string, next: URL) => {
      url = new URL(next);
    }),
  };
  const browser = {
    get location() {
      return { href: url.href };
    },
    history,
    addEventListener: (name: string, callback: () => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as Window;
  const environments = new EnvironmentsStore([
    { id: "local", name: "本机", kind: "local", url: "ws://localhost:4501" },
    { id: "remote", name: "远程", kind: "remote", url: "ws://localhost:4502" },
  ]);
  const route = new SessionUrlStore(environments, browser);
  return {
    route,
    environments,
    history,
    browser,
    pop(next: string) {
      url = new URL(next);
      listeners.get("popstate")?.();
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

it("preserves unrelated query parameters and hashes, and encodes session IDs", () => {
  const url = writeSessionUrl(
    new URL("http://localhost/?theme=dark#main"),
    "remote",
    "id /?#",
  );
  expect(readSessionUrl(url)).toEqual({
    environmentId: "remote",
    sessionId: "id /?#",
    explicit: true,
  });
  expect(url.searchParams.get("theme")).toBe("dark");
  expect(url.hash).toBe("#main");
});
it("keeps an offline deep link intact and distinguishes an unknown environment", () => {
  const ctx = setup("http://localhost/?env=remote&session=same");
  const stop = ctx.route.start();
  expect(ctx.environments.active().id).toBe("remote");
  expect(ctx.route.getSnapshot().status).toBe("waiting");
  expect(ctx.history.pushState).not.toHaveBeenCalled();
  ctx.pop("http://localhost/?env=missing&session=same");
  expect(ctx.route.getSnapshot().status).toBe("error");
  stop();
});
it("updates navigation for draft creation and browser back without adding another history entry", async () => {
  const ctx = setup("http://localhost/");
  const stop = ctx.route.start();
  expect(ctx.history.replaceState).toHaveBeenCalledOnce();
  const draft = await ctx.environments.active().runtime.sessions.create();
  await flush();
  expect(new URL(ctx.browser.location.href).searchParams.get("session")).toBe(
    draft.id,
  );
  expect(ctx.history.pushState).toHaveBeenCalledOnce();
  ctx.pop("http://localhost/?env=local");
  await flush();
  expect(
    ctx.environments.active().runtime.sessions.getSnapshot().selectedId,
  ).toBeNull();
  expect(ctx.history.pushState).toHaveBeenCalledOnce();
  stop();
});
it("opens in the specified runtime, supports retry, and does not replace a failed link", async () => {
  const ctx = setup("http://localhost/?env=remote&session=same");
  const runtime = ctx.environments.getSnapshot().entries[1].runtime;
  const snapshot = runtime.connection.getSnapshot();
  vi.spyOn(runtime.connection, "getSnapshot").mockImplementation(() => ({
    ...snapshot,
    status: "connected",
  }));
  const open = vi
    .spyOn(runtime.sessions, "open")
    .mockRejectedValueOnce(new Error("not found"))
    .mockResolvedValueOnce();
  const stop = ctx.route.start();
  await flush();
  expect(open).toHaveBeenCalledWith("same");
  expect(ctx.route.getSnapshot().status).toBe("error");
  expect(ctx.history.pushState).not.toHaveBeenCalled();
  ctx.route.retry();
  await flush();
  expect(open).toHaveBeenCalledTimes(2);
  expect(ctx.route.getSnapshot().status).toBe("ready");
  stop();
});
