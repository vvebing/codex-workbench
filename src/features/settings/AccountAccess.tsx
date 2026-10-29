import { t, useLocale } from "../../lib/i18n";
import { AccountStatus } from "../connection/AccountStatus";
import { useEffect, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { useStore } from "../../components/hooks";
import type { ConnectionStore } from "../connection/store";
import { safeElicitationUrl } from "../approvals/validation";
import {
  SettingsField,
  SettingsSection,
  settingsInputClass,
} from "./settings-ui";

export function AccountAccess({ connection }: { connection: ConnectionStore }) {
  useLocale();
  const state = useStore(connection.accountAccess);
  const { status, epoch } = useStore(connection);
  const connected = status === "connected";
  const [apiKey, setApiKey] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  useEffect(() => {
    setApiKey("");
    setConfirmLogout(false);
  }, [connection, epoch]);
  const disabled = !connected || state.busy;
  const login = state.login;
  const url =
    login &&
    safeElicitationUrl(
      login.type === "chatgpt" ? login.authUrl : login.verificationUrl,
    );
  return (
    <SettingsSection
      title={t("账号与用量")}
      description={t(
        "登录与退出影响所选环境的 Codex 账户。远端环境建议使用设备码登录。",
      )}
    >
      <AccountStatus connection={connection} />
      {login ? (
        <div className="space-y-3 text-sm">
          {url ? (
            <a
              className="text-accent underline [overflow-wrap:anywhere]"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("打开登录授权页面")}
            </a>
          ) : (
            <p role="alert">
              {t("服务端返回的授权链接不可用，请取消后重试。")}
            </p>
          )}
          {login.type === "chatgptDeviceCode" && (
            <p>
              {t("设备验证码：")}
              <code className="select-all">{login.userCode}</code>
            </p>
          )}
          <Button
            disabled={disabled}
            onClick={() => void connection.accountAccess.cancel()}
          >
            {t("取消登录")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled}
              onClick={() =>
                void connection.accountAccess.start({
                  type: "chatgptDeviceCode",
                })
              }
            >
              {t("设备码登录")}
            </Button>
            <Button
              disabled={disabled}
              onClick={() =>
                void connection.accountAccess.start({ type: "chatgpt" })
              }
            >
              {t("浏览器登录")}
            </Button>
            <Button disabled={disabled} onClick={() => setConfirmLogout(true)}>
              {t("退出账户")}
            </Button>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const value = apiKey.trim();
              if (!value) return;
              setApiKey("");
              void connection.accountAccess.start({
                type: "apiKey",
                apiKey: value,
              });
            }}
          >
            <SettingsField id="account-api-key" label="OpenAI API Key">
              <input
                id="account-api-key"
                type="password"
                autoComplete="off"
                className={settingsInputClass}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={disabled}
              />
            </SettingsField>
            <Button type="submit" disabled={disabled || !apiKey.trim()}>
              {t("使用 API Key 登录")}
            </Button>
          </form>
        </>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-muted">
          {state.message}
        </p>
      )}
      <Modal
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title={t("退出当前环境账户")}
        description={t(
          "退出会影响此环境中的其他 Codex 客户端及后续任务。正在执行的任务可能失败。",
        )}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmLogout(false)}>{t("取消")}</Button>
          <Button
            disabled={disabled}
            onClick={() => {
              setConfirmLogout(false);
              void connection.accountAccess.logout();
            }}
          >
            {t("确认退出")}
          </Button>
        </div>
      </Modal>
    </SettingsSection>
  );
}
