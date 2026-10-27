import { useState } from "react";
import { t, useLocale } from "../../lib/i18n";
import { Button } from "../../components/ui";
import { environments, type Environment } from "../connection/environments";
import {
  DEFAULT_FILE_LIMITS,
  normalizeFileLimits,
  type FileLimits,
} from "../files/file-limits";
import {
  SettingsSection,
  SettingsField,
  SettingsActions,
  settingsInputClass,
} from "./settings-ui";

const fields = [
  "normalBytes",
  "editableBytes",
  "viewBytes",
  "diffBytes",
] as const;
const toInputs = (limits: FileLimits) =>
  Object.fromEntries(
    fields.map((key) => [key, String(limits[key] / (1024 * 1024))]),
  ) as Record<keyof FileLimits, string>;
export function FileSettings({ environment }: { environment: Environment }) {
  useLocale();
  const [inputs, setInputs] = useState(() =>
    toInputs(normalizeFileLimits(environment.fileLimits)),
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const labels: Record<keyof FileLimits, string> = {
    normalBytes: t("普通模式上限（MB）"),
    editableBytes: t("编辑上限（MB）"),
    viewBytes: t("查看上限（MB）"),
    diffBytes: t("差异上限（每个版本，MB）"),
  };
  const descriptions: Record<keyof FileLimits, string> = {
    normalBytes: t(
      "超过此大小使用纯文本精简模式，关闭 Markdown 渲染和自动 Git 行标记。",
    ),
    editableBytes: t(
      "超过此大小的文件只读查看；已有未保存内容仍可撤销或缩减。",
    ),
    viewBytes: t("用于编辑器、Git 文件读取和工作区图片预览。"),
    diffBytes: t("分别限制原版本和新版本，适用于 Git、磁盘及未保存更改比较。"),
  };
  function save(value: Record<keyof FileLimits, string>) {
    setError("");
    setSaved(false);
    let limits: FileLimits;
    try {
      limits = normalizeFileLimits(
        Object.fromEntries(
          fields.map((key) => [
            key,
            Math.round(Number(value[key]) * 1024 * 1024),
          ]),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    try {
      environments.setFileLimits(environment.id, limits);
      setInputs(toInputs(limits));
      setSaved(true);
    } catch {
      setError(t("无法保存偏好，请检查浏览器存储权限后重试。"));
    }
  }
  return (
    <SettingsSection
      title={t("文件与差异")}
      description={t(
        "按工作环境保存在当前浏览器。设置影响文件展示和编辑，不改变上传附件的大小限制。",
      )}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save(inputs);
        }}
      >
        {fields.map((key) => (
          <SettingsField
            key={key}
            id={`file-limit-${key}`}
            label={labels[key]}
            description={descriptions[key]}
          >
            <input
              id={`file-limit-${key}`}
              className={settingsInputClass}
              type="number"
              min="0.25"
              max="8"
              step="any"
              required
              value={inputs[key]}
              aria-describedby={`file-limit-${key}-description${error ? " file-limits-error" : ""}`}
              aria-invalid={!!error}
              onChange={(event) => {
                setInputs((previous) => ({
                  ...previous,
                  [key]: event.target.value,
                }));
                setError("");
                setSaved(false);
              }}
            />
          </SettingsField>
        ))}
        <p className="text-xs leading-relaxed text-muted">
          {t(
            "可设置 0.25–8 MB。普通模式 ≤ 编辑 ≤ 查看，差异 ≤ 查看。8 MB 是当前整文件传输的上限。已打开的超限文件可在调整后重新加载，未保存草稿不会被丢弃。",
          )}
        </p>
        {error && (
          <p
            id="file-limits-error"
            role="alert"
            className="text-xs text-danger"
          >
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-xs text-muted">
            {t("已保存")}
          </p>
        )}
        <SettingsActions>
          <Button
            type="button"
            onClick={() => save(toInputs(DEFAULT_FILE_LIMITS))}
          >
            {t("恢复默认限制")}
          </Button>
          <Button type="submit" variant="primary">
            {t("保存文件限制")}
          </Button>
        </SettingsActions>
      </form>
    </SettingsSection>
  );
}
