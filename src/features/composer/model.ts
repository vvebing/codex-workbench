import type { Model } from "../../generated/v2/Model";
import type { Thread } from "../../generated/v2/Thread";
import type { ReasoningEffort } from "../../generated/ReasoningEffort";
export function composerModel(
  models: Model[],
  thread: Pick<Thread, "model" | "reasoningEffort"> | undefined,
  chosenModel: string,
  chosenEffort?: ReasoningEffort,
  defaultModel = "",
  inheritDeviceDefault = false,
) {
  const modelId =
    chosenModel ||
    defaultModel ||
    thread?.model ||
    (inheritDeviceDefault
      ? undefined
      : models.find((model) => model.isDefault)?.model || models[0]?.model);
  const model = models.find((model) => model.model === modelId);
  const effort =
    chosenEffort ??
    (modelId
      ? (((!chosenModel && !defaultModel) || modelId === thread?.model
          ? thread?.reasoningEffort
          : undefined) ?? model?.defaultReasoningEffort)
      : undefined);
  return { modelId, model, effort };
}
