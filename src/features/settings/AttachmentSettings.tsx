import { useState } from "react";
import { t, useLocale } from "../../lib/i18n";
import { Button } from "../../components/ui";
import { environments, type Environment } from "../connection/environments";
import {
  DEFAULT_ATTACHMENT_DIRECTORY,
  normalizeAttachmentDirectory,
} from "./attachment-preferences";
import {
  SettingsSection,
  SettingsField,
  SettingsActions,
  settingsInputClass,
} from "./settings-ui";

export function AttachmentSettings({
  environment,
}: {
  environment: Environment;
}) {
  useLocale();
  const [path, setPath] = useState(
    environment.attachmentDirectory ?? DEFAULT_ATTACHMENT_DIRECTORY,
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  function save(value: string) {
    setError("");
    setSaved(false);
    let normalized: string;
    try {
      normalized = normalizeAttachmentDirectory(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    try {
      environments.setAttachmentDirectory(environment.id, normalized);
      setPath(normalized);
      setSaved(true);
    } catch {
      setError(t("无法保存偏好，请检查浏览器存储权限后重试。"));
    }
  }
  return (
    <SettingsSection
      title={t("附件存储")}
      description={t(
        "按工作环境分别保存到当前浏览器，应用于此环境后续上传或粘贴的文件和图片。已有附件不会移动。",
      )}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save(path);
        }}
      >
        <SettingsField
          id="attachment-directory"
          label={t("附件保存路径")}
          description={t(
            "支持 ~/ 开头的路径或绝对路径。~ 表示所选工作环境的用户主目录，目录不存在时会在上传时自动创建。留空使用默认路径。",
          )}
        >
          <input
            id="attachment-directory"
            className={settingsInputClass}
            value={path}
            placeholder={DEFAULT_ATTACHMENT_DIRECTORY}
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
            aria-invalid={!!error}
            aria-describedby={`attachment-directory-description${error ? " attachment-directory-error" : ""}`}
            onChange={(event) => {
              setPath(event.target.value);
              setError("");
              setSaved(false);
            }}
          />
        </SettingsField>
        <p className="text-xs text-muted">
          {t("默认路径：{{path}}", { path: DEFAULT_ATTACHMENT_DIRECTORY })}
        </p>
        {error && (
          <p
            id="attachment-directory-error"
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
            onClick={() => save(DEFAULT_ATTACHMENT_DIRECTORY)}
          >
            {t("恢复默认路径")}
          </Button>
          <Button type="submit" variant="primary">
            {t("保存路径")}
          </Button>
        </SettingsActions>
      </form>
    </SettingsSection>
  );
}
