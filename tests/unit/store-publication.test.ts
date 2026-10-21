import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../src/lib/store";
class TestStore extends Store<number> {
  constructor() {
    super(0);
  }
  set(value: number, deferred = false) {
    this.update(value, deferred);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function browser() {
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++serial, callback);
      return serial;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  return {
    frame: () => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    },
    frames,
  };
}
describe("store publication", () => {
  it("advances state immediately and publishes accumulated deltas once per frame", () => {
    const { frame } = browser();
    const store = new TestStore();
    const values: number[] = [];
    store.subscribe(() => values.push(store.getSnapshot()));
    store.set(1, true);
    store.set(2, true);
    expect(store.getSnapshot()).toBe(2);
    expect(values).toEqual([]);
    frame();
    expect(values).toEqual([2]);
    expect(vi.getTimerCount()).toBe(0);
    store.set(3, true);
    frame();
    expect(values).toEqual([2, 3]);
  });
  it("publishes terminal updates immediately and cancels pending callbacks", () => {
    const { frame, frames } = browser();
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(1, true);
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(2);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    frame();
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set(3, true);
    store.set(3);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("falls back to a bounded timer when frames are suspended and cleans up on unsubscribe", () => {
    const { frame, frames } = browser();
    const store = new TestStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.set(1, true);
    vi.advanceTimersByTime(50);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    frame();
    expect(listener).toHaveBeenCalledTimes(1);
    store.set(2, true);
    off();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getSnapshot()).toBe(2);
  });
  it("publishes deferred updates immediately in Node", () => {
    vi.stubGlobal("window", undefined);
    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(1, true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(1);
    store.set(1, true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
