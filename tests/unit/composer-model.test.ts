import { expect, it } from "vitest";
import { composerModel } from "../../src/features/composer/model";
import type { Model } from "../../src/generated/v2/Model";
const models = [
  {
    model: "sol",
    displayName: "Sol",
    isDefault: true,
    defaultReasoningEffort: "low",
  },
  { model: "other", defaultReasoningEffort: "medium" },
] as Model[];
it("preserves the session effort rather than silently using the catalog default", () => {
  const result = composerModel(
    models,
    { model: "sol", reasoningEffort: "high" },
    "",
  );
  expect(result.modelId).toBe("sol");
  expect(result.effort).toBe("high");
});
it("honors manual choices and uses the new model default after switching models", () => {
  const thread = { model: "sol", reasoningEffort: "high" };
  expect(composerModel(models, thread, "", "medium").effort).toBe("medium");
  expect(composerModel(models, thread, "other").effort).toBe("medium");
  expect(composerModel(models, thread, "other", "low").effort).toBe("low");
});
it("retains unknown session models and only falls back when no configuration exists", () => {
  const unknown = composerModel(
    models,
    { model: "custom-model", reasoningEffort: "xhigh" },
    "",
  );
  expect(unknown.modelId).toBe("custom-model");
  expect(unknown.model).toBeUndefined();
  expect(unknown.effort).toBe("xhigh");
  expect(
    composerModel(models, { model: null, reasoningEffort: null }, "").effort,
  ).toBe("low");
});

it("prefers the saved new-session model while preserving manual overrides", () => {
  const draft = { model: null, reasoningEffort: null };
  expect(composerModel(models, draft, "", undefined, "other").modelId).toBe(
    "other",
  );
  expect(composerModel(models, draft, "", undefined, "other").effort).toBe(
    "medium",
  );
  expect(composerModel(models, draft, "sol", undefined, "other").modelId).toBe(
    "sol",
  );
  expect(composerModel(models, draft, "", undefined, "").modelId).toBe("sol");
  expect(
    composerModel(models, draft, "", undefined, "custom-model").modelId,
  ).toBe("custom-model");
});

it("inherits device configuration for new drafts without guessing from the catalog", () => {
  const draft = { model: null, reasoningEffort: null };
  expect(composerModel(models, draft, "", undefined, "", true)).toEqual({
    modelId: undefined,
    model: undefined,
    effort: undefined,
  });
  expect(composerModel(models, draft, "", "high", "", true).effort).toBe(
    "high",
  );
  expect(
    composerModel(models, draft, "", undefined, "other", true),
  ).toMatchObject({ modelId: "other", effort: "medium" });
  expect(
    composerModel(models, draft, "sol", undefined, "other", true),
  ).toMatchObject({ modelId: "sol", effort: "low" });
  expect(
    composerModel(
      models,
      { model: "custom-start", reasoningEffort: "high" },
      "",
      undefined,
      "",
      true,
    ),
  ).toMatchObject({ modelId: "custom-start", effort: "high" });
});
