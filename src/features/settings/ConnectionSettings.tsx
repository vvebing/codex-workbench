import { AccountAccess } from "./AccountAccess";
import { AppServerVersion } from "./AppServerVersion";
import { useEffect, useRef, useState } from "react";
import {
  LoaderCircle,
  Monitor,
  Plug,
  Server,
  Trash2,
  Unplug,
} from "lucide-react";
import { Button, ErrorNotice } from "../../components/ui";
import { useStore } from "../../components/hooks";
import { environments, type Environment } from "../connection/environments";
import {
  SettingsActions,
  SettingsField,
  SettingsSection,
  settingsInputClass,
} from "./settings-ui";

export function useConnectionSettings({
  open,
  active,
  entries,
  onOpenChange,
}: {
  open: boolean;
  active: Environment;
  entries: Environment[];
  onOpenChange: (open: boolean) => void;
}) {
  const [id, setId] = useState(active.id);
  const [name, setName] = useState(active.name);
  const [kind, setKind] = useState(active.kind);
  const [url, setUrl] = useState(active.url);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selected = entries.find((entry) => entry.id === id);
  const connection = useStore((selected || active).runtime.connection);
  const connected = !!selected && connection.status === "connected";
  const choose = (entry: Environment) => {
    setId(entry.id);
    setName(entry.name);
    setKind(entry.kind);
    setUrl(entry.url);
    setToken("");
    setError("");
  };
  useEffect(() => {
    setToken("");
    if (!open) return;
    setId(active.id);
    setName(active.name);
    setKind(active.kind);
    setUrl(active.url);
    setError("");
  }, [open, active.id, active.name, active.kind, active.url]);
  const clearSensitive = () => {
    setToken("");
    setError("");
  };
  const add = () => {
    if (lock.current) return;
    setId(crypto.randomUUID());
    setName("开发机");
    setKind("remote");
    setUrl("ws://127.0.0.1:4500");
    clearSensitive();
  };
  async function action(task: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function saveProfile() {
    const address = new URL(url);
    if (
      !["ws:", "wss:"].includes(address.protocol) ||
      address.username ||
      address.password ||
      address.hash
    )
      throw Error("请输入 ws:// 或 wss:// 地址，不要包含账号、密码或片段。");
    if (/[\r\n]/.test(token)) throw Error("Token 不能包含换行。");
    if (!name.trim()) throw Error("请填写环境名称。");
    return environments.save(
      { id, name: name.trim(), kind, url: address.toString() },
      false,
    );
  }
  const save = () => action(async () => void saveProfile());
  const connect = () =>
    action(async () => {
      const entry = saveProfile();
      await entry.runtime.connect(entry.url, token);
      environments.select(entry.id);
      setToken("");
      onOpenChange(false);
    });
  const disconnect = () => {
    if (lock.current || !selected) return;
    selected.runtime.connection.disconnect();
    setError("");
  };
  const remove = () =>
    action(async () => {
      environments.remove(id);
      choose(environments.active());
    });
  return {
    id,
    name,
    kind,
    url,
    token,
    error: error || (selected ? connection.error : ""),
    busy,
    selected,
    connected,
    serverVersion: connection.serverVersion,
    connectionEpoch: connection.epoch,
    connecting: !!selected && connection.status === "connecting",
    setName,
    setUrl,
    setToken,
    choose,
    add,
    clearSensitive,
    save,
    connect,
    disconnect,
    remove,
  };
}

export function ConnectionSettings({
  settings,
}: {
  settings: ReturnType<typeof useConnectionSettings>;
}) {
  const Icon = settings.kind === "local" ? Monitor : Server;
  return (
    <div className="space-y-6">
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            <Icon size={16} />
            {settings.selected ? "连接信息" : "添加开发机连接"}
          </span>
        }
        trailing={
          <span className="shrink-0 text-xs text-muted">
            {settings.connected
              ? `已连接${settings.serverVersion ? ` · ${settings.serverVersion}` : ""}`
              : settings.connecting
                ? "正在连接…"
                : "未连接"}
          </span>
        }
      >
        {settings.connected && (
          <AppServerVersion
            key={`${settings.selected?.id}:${settings.connectionEpoch}`}
            version={settings.serverVersion}
          />
        )}
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void settings.connect();
          }}
        >
          <div className="grid gap-4">
            <SettingsField id="environment-name" label="环境名称">
              <input
                id="environment-name"
                className={settingsInputClass}
                value={settings.name}
                onChange={(event) => settings.setName(event.target.value)}
                maxLength={80}
                required
                disabled={settings.busy}
              />
            </SettingsField>
            <SettingsField id="app-server-url" label="App-server 地址">
              <input
                id="app-server-url"
                className={settingsInputClass}
                value={settings.url}
                onChange={(event) => settings.setUrl(event.target.value)}
                placeholder={
                  settings.kind === "local"
                    ? "ws://127.0.0.1:4501"
                    : "ws://127.0.0.1:4500"
                }
                autoComplete="off"
                required
                disabled={settings.busy}
              />
            </SettingsField>
            <SettingsField
              id="environment-token"
              label={
                <>
                  Bearer Token{" "}
                  <span className="font-normal text-muted">
                    （可选，仅在当前表单内存中）
                  </span>
                </>
              }
            >
              <input
                id="environment-token"
                className={settingsInputClass}
                type="password"
                value={settings.token}
                onChange={(event) => settings.setToken(event.target.value)}
                autoComplete="off"
                disabled={settings.busy}
              />
            </SettingsField>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {settings.kind === "local"
              ? import.meta.env.DEV
                ? "请先在本机终端手动启动 app-server，再填写监听地址。"
                : "网页服务会自动启动或复用本机 app-server；若连接失败，请查看终端输出，或在本机终端手动启动后填写监听地址。"
              : "先在远端启动 app-server，再填写 SSH 端口转发后的本机地址。"}
          </p>
          {settings.error && <ErrorNotice>{settings.error}</ErrorNotice>}
          <SettingsActions>
            {settings.connected && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={settings.busy}
                onClick={settings.disconnect}
              >
                <Unplug size={15} />
                断开连接
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={settings.busy}
              onClick={() => void settings.save()}
            >
              保存配置
            </Button>
            <Button
              variant="primary"
              type="submit"
              size="sm"
              disabled={settings.busy}
            >
              {settings.busy ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Plug size={15} />
              )}
              {settings.busy
                ? "正在连接…"
                : settings.connected
                  ? "使用此连接"
                  : "连接"}
            </Button>
          </SettingsActions>
        </form>
      </SettingsSection>
      {settings.selected && (
        <AccountAccess
          key={settings.selected.id}
          connection={settings.selected.runtime.connection}
        />
      )}
      {settings.kind === "local" && (
        <SettingsSection title="本机启动指引">
          <p className="text-xs leading-relaxed text-muted">
            在终端执行：
            <code className="mt-2 block whitespace-normal rounded-lg bg-surface p-3 [overflow-wrap:anywhere]">
              codex app-server --listen ws://127.0.0.1:4501
            </code>
          </p>
        </SettingsSection>
      )}
      {settings.selected && settings.id !== "local" && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-xs leading-relaxed text-muted">
            移除此环境的配置，会断开对应连接。
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={settings.busy}
            onClick={() => void settings.remove()}
          >
            <Trash2 size={14} />
            移除环境
          </Button>
        </div>
      )}
    </div>
  );
}
