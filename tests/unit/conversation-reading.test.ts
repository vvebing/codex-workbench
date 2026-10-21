import { describe, expect, it } from "vitest";
import { ConversationReadingCache } from "../../src/features/conversation/reading-state";

describe("conversation reading cache", () => {
  it("restores reading and expansion choices within the same scope and thread", () => {
    const cache = new ConversationReadingCache();
    const entry = cache.entry("environment/account", "thread-a");
    entry.reading = {
      following: false,
      turnId: "turn-3",
      offset: -12,
      scrollTop: 450,
    };
    entry.choices.set("process:message-3", false);
    cache.entry("environment/account", "thread-b");
    expect(cache.entry("environment/account", "thread-a")).toBe(entry);
    expect(entry.reading.turnId).toBe("turn-3");
    expect(entry.choices.get("process:message-3")).toBe(false);
    expect(cache.entry("other-account", "thread-a").reading).toBeUndefined();
    expect(cache.entry("environment/account", "thread-b").choices.size).toBe(0);
  });
  it("evicts the least recently visited conversation without retaining DOM", () => {
    const cache = new ConversationReadingCache(2);
    cache.entry("scope", "a").choices.set("expanded", true);
    cache.entry("scope", "b");
    cache.entry("scope", "a");
    cache.entry("scope", "c");
    expect(cache.entry("scope", "a").choices.get("expanded")).toBe(true);
    expect(cache.entry("scope", "b").choices.size).toBe(0);
  });
});
