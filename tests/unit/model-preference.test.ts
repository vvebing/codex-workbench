import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_STORAGE_KEY,
  getDefaultModel,
  setDefaultModel,
} from "../../src/features/settings/model-preference";
afterEach(() => vi.unstubAllGlobals());
it("persists the model and reads it on subsequent new sessions", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  expect(getDefaultModel()).toBe("");
  setDefaultModel("  custom-model  ");
  expect(storage.get(DEFAULT_MODEL_STORAGE_KEY)).toBe("custom-model");
  expect(getDefaultModel()).toBe("custom-model");
  setDefaultModel("");
  expect(getDefaultModel()).toBe("");
});
it("falls back safely when reading storage is blocked and reports save failures", () => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    },
  });
  expect(getDefaultModel()).toBe("");
  expect(() => setDefaultModel("custom-model")).toThrow("blocked");
});
