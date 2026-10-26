import { t, useLocale } from "../../lib/i18n";
import { useEffect, useState } from "react";
import type { Model } from "../../generated/v2/Model";
import { Button, SelectField } from "../../components/ui";
import { getDefaultModel, setDefaultModel } from "./model-preference";
import {
  SettingsActions,
  SettingsField,
  SettingsSection,
  settingsInputClass,
  settingsSelectClass,
} from "./settings-ui";

export function useSessionSettings(open: boolean) {
  const [value, setValue] = useState(getDefaultModel);
  const [custom, setCustom] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setValue(getDefaultModel());
    setCustom(false);
    setFeedback("");
    setError("");
  }, [open]);
  const change = (model: string, custom = false) => {
    setValue(model);
    setCustom(custom);
    setFeedback("");
    setError("");
  };
  const save = () => {
    setError("");
    try {
      setDefaultModel(value);
      setFeedback("浏览器偏好已保存");
    } catch {
      setFeedback("");
      setError("保存失败，请检查浏览器是否允许本地存储后重试。");
    }
  };
  return { value, custom, feedback, error, change, save };
}

export function SessionSettings({
  settings,
  models,
  environmentName,
}: {
  settings: ReturnType<typeof useSessionSettings>;
  models: Model[];
  environmentName: string;
}) {
  useLocale();
  const selectedModel =
    settings.custom ||
    (settings.value && !models.some((model) => model.model === settings.value))
      ? "custom"
      : settings.value
        ? `model:${settings.value}`
        : "environment";

  return (
    <SettingsSection title={t("本浏览器的新会话模型")}>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          settings.save();
        }}
      >
        <SettingsField
          id="new-session-default-model"
          label={t("新建会话默认模型")}
          description={t(
            "模型列表来自设备「{{v0}}」。此偏好保存在当前浏览器中，适用于所有环境的新建会话；输入区显式选择的模型优先。不同设备可用的模型可能不同，也可填写自定义模型 ID。",
            { v0: environmentName },
          )}
        >
          <SelectField
            id="new-session-default-model"
            label={t("新建会话默认模型")}
            value={selectedModel}
            onValueChange={(value) => {
              if (value === "custom") settings.change(settings.value, true);
              else
                settings.change(
                  value === "environment" ? "" : value.slice("model:".length),
                );
            }}
            options={[
              { value: "environment", label: t("跟随设备默认模型") },
              ...models.map((model) => ({
                value: `model:${model.model}`,
                label: model.displayName,
              })),
              { value: "custom", label: t("自定义模型") },
            ]}
            aria-describedby="new-session-default-model-description"
            className={settingsSelectClass}
          />
        </SettingsField>
        {selectedModel === "custom" && (
          <SettingsField
            id="new-session-custom-model"
            label={t("自定义模型 ID")}
            description={t(
              "填写目标设备支持的模型 ID；留空跟随该设备提供的默认模型。",
            )}
          >
            <input
              id="new-session-custom-model"
              value={settings.value}
              onChange={(event) => settings.change(event.target.value, true)}
              placeholder={t("输入模型 ID")}
              autoComplete="off"
              aria-describedby="new-session-custom-model-description"
              className={settingsInputClass}
            />
          </SettingsField>
        )}
        <SettingsActions>
          {settings.feedback && (
            <span role="status" className="mr-auto text-xs text-success">
              {t(settings.feedback)}
            </span>
          )}
          {settings.error && (
            <span role="alert" className="mr-auto text-xs text-danger">
              {t(settings.error)}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => settings.change("")}
          >
            {t("跟随设备默认")}
          </Button>
          <Button type="submit" variant="primary" size="sm">
            {t("保存浏览器偏好")}
          </Button>
        </SettingsActions>
      </form>
    </SettingsSection>
  );
}
