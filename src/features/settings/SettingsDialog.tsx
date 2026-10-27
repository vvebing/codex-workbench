import { t, useLocale } from "../../lib/i18n";
import { Fragment, useEffect, useState } from "react";
import { Tabs } from "radix-ui";
import { History, Plug, Plus, Settings2, Terminal } from "lucide-react";
import { ScrollArea, Button, Modal } from "../../components/ui";
import { useStore, useNarrow } from "../../components/hooks";
import { environments } from "../connection/environments";
import { ConfigMigration } from "./ConfigMigration";
import type { Environment } from "../connection/environments";
import { ProjectConfig } from "./ProjectConfig";
import { EnvironmentTools } from "./EnvironmentTools";
import { ConversationSettings } from "./ConversationSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { SessionSettings, useSessionSettings } from "./SessionSettings";
import {
  ConnectionSettings,
  useConnectionSettings,
} from "./ConnectionSettings";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { AppServerTerminal } from "./AppServerTerminal";
import { ArchivedThreads } from "./ArchivedThreads";
import { AttachmentSettings } from "./AttachmentSettings";
import { FileSettings } from "./FileSettings";

const sections = [
  {
    value: "general",
    get label() {
      return t("通用");
    },
    Icon: Settings2,
    get description() {
      return t("调整当前浏览器的显示与会话交互偏好。");
    },
  },
  {
    value: "connections",
    get label() {
      return t("工作环境");
    },
    Icon: Plug,
    get description() {
      return t("按设备管理连接、账号、模型配置和工具集成。");
    },
  },
  {
    value: "activity",
    get label() {
      return t("已归档的会话");
    },
    Icon: History,
    get description() {
      return t("按工作区查看已归档会话，恢复后可继续对话。");
    },
  },
  {
    value: "terminal",
    get label() {
      return t("终端输出");
    },
    Icon: Terminal,
    get description() {
      return t("查看网页服务自动启动的本机 Codex 进程输出。");
    },
  },
] as const;

export function SettingsDialog({
  open,
  onOpenChange,
  onRestored,
  initialSection = "general",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (id: string) => void;
  initialSection?: "general" | "activity";
}) {
  useLocale();
  const state = useStore(environments);
  const active = environments.active();
  const narrow = useNarrow();
  const [section, setSection] = useState<string>(initialSection);
  const [environmentPage, setEnvironmentPage] =
    useState<EnvironmentPage>("connection");
  const sessionSettings = useSessionSettings(open);
  const connectionSettings = useConnectionSettings({
    open,
    active,
    entries: state.entries,
    onOpenChange,
  });
  useEffect(() => {
    if (open) {
      setSection(initialSection);
      setEnvironmentPage("connection");
    }
  }, [open, initialSection]);
  const current = sections.find((entry) => entry.value === section)!;
  const managesEnvironment =
    section === "connections" || section === "activity";
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) connectionSettings.clearSensitive();
        onOpenChange(next);
      }}
      title={t("连接与设置")}
      variant="settings"
      returnFocusSelector={
        narrow ? "[data-navigation-trigger]" : "[data-settings-trigger]"
      }
      description={t("管理通用偏好、工作环境、已归档会话与终端输出。")}
    >
      <Tabs.Root
        className="flex min-h-0 min-w-0 flex-1 border-t border-border max-[900px]:flex-col"
        value={section}
        orientation={narrow ? "horizontal" : "vertical"}
        onValueChange={(value) => {
          if (connectionSettings.busy) return;
          setSection(value);
          connectionSettings.clearSensitive();
        }}
      >
        <Tabs.List
          className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 max-[900px]:max-h-[40dvh] max-[900px]:overflow-y-auto max-[900px]:grid max-[900px]:w-full max-[900px]:grid-cols-2 max-[900px]:border-r-0 max-[900px]:border-b"
          aria-label={t("设置分类")}
        >
          {sections.map(({ value, label, Icon }) => (
            <Fragment key={value}>
              <Tabs.Trigger
                value={value}
                disabled={connectionSettings.busy}
                className={`flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-control text-muted hover:bg-hover data-[state=active]:font-semibold data-[state=active]:text-accent max-[900px]:min-h-11 max-[900px]:justify-center max-[900px]:px-2 max-[550px]:text-xs ${value !== "connections" ? "data-[state=active]:bg-selected" : ""}`}
              >
                <Icon
                  className="max-[550px]:hidden"
                  size={16}
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">{label}</span>
              </Tabs.Trigger>
              {value === "connections" && section === "connections" && (
                <div
                  className="ml-5 space-y-1 border-l border-border pl-2 max-[900px]:col-span-2 max-[900px]:order-last max-[900px]:ml-0 max-[900px]:grid max-[900px]:grid-cols-2 max-[900px]:gap-1 max-[900px]:space-y-0 max-[900px]:border-l-0 max-[900px]:border-t max-[900px]:pt-2 max-[900px]:pl-0"
                  role="group"
                  aria-label={t("工作环境设置")}
                >
                  {environmentPages.map(({ value: page, label: pageLabel }) => (
                    <button
                      key={page}
                      type="button"
                      aria-current={
                        environmentPage === page ? "page" : undefined
                      }
                      disabled={
                        connectionSettings.busy ||
                        (page !== "connection" && !connectionSettings.selected)
                      }
                      className="flex min-h-10 w-full items-center rounded-lg px-3 py-2 text-left text-control text-muted hover:bg-hover aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-accent disabled:opacity-50 max-[900px]:min-h-11"
                      onClick={() => {
                        setEnvironmentPage(page);
                        connectionSettings.clearSensitive();
                      }}
                    >
                      {pageLabel}
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          ))}
        </Tabs.List>
        <ScrollArea data-slot="settings-content" className="min-w-0 flex-1">
          <div className="min-w-0 space-y-6 p-6 [overflow-wrap:anywhere] max-[550px]:p-4">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="text-lg font-semibold">
                  {section === "connections"
                    ? environmentPages.find(
                        (page) => page.value === environmentPage,
                      )!.label
                    : current.label}
                </h3>
                <p className="text-xs leading-relaxed text-muted">
                  {current.description}
                </p>
              </div>
              {section === "connections" && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={connectionSettings.busy}
                  onClick={() => {
                    setEnvironmentPage("connection");
                    connectionSettings.add();
                  }}
                >
                  <Plus size={15} />
                  {t("添加开发机")}
                </Button>
              )}
            </header>
            {managesEnvironment && (
              <EnvironmentSelector
                entries={state.entries}
                selectedId={connectionSettings.id}
                onSelect={connectionSettings.choose}
                disabled={connectionSettings.busy}
                draft={
                  section === "connections" && !connectionSettings.selected
                }
              />
            )}
            <Tabs.Content value="terminal">
              <AppServerTerminal />
            </Tabs.Content>
            <Tabs.Content value="general" className="space-y-6">
              <AppearanceSettings />
              <ConversationSettings />
            </Tabs.Content>
            <Tabs.Content value="connections" className="space-y-6">
              {environmentPage === "connection" ||
              !connectionSettings.selected ? (
                <ConnectionSettings settings={connectionSettings} />
              ) : (
                <EnvironmentPanels
                  key={connectionSettings.selected.id + ":" + environmentPage}
                  environment={connectionSettings.selected}
                  page={environmentPage}
                  sessionSettings={sessionSettings}
                  onInserted={() => onOpenChange(false)}
                />
              )}
            </Tabs.Content>
            <Tabs.Content value="activity">
              {connectionSettings.selected ? (
                <ArchivedThreads
                  key={connectionSettings.selected.id}
                  environment={connectionSettings.selected}
                  onRestored={onRestored}
                />
              ) : (
                <p className="text-xs text-muted">
                  {t("请选择已保存的工作环境。")}
                </p>
              )}
            </Tabs.Content>
          </div>
        </ScrollArea>
      </Tabs.Root>
    </Modal>
  );
}

const environmentPages = [
  {
    value: "connection",
    get label() {
      return t("连接与账户");
    },
  },
  {
    value: "configuration",
    get label() {
      return t("模型与权限");
    },
  },
  {
    value: "integrations",
    get label() {
      return t("工具与集成");
    },
  },
  {
    value: "files",
    get label() {
      return t("文件与差异");
    },
  },
  {
    value: "attachments",
    get label() {
      return t("附件存储");
    },
  },
  {
    value: "migration",
    get label() {
      return t("配置迁移");
    },
  },
] as const;
type EnvironmentPage = (typeof environmentPages)[number]["value"];

function EnvironmentPanels({
  environment,
  page,
  sessionSettings,
  onInserted,
}: {
  environment: Environment;
  page: Exclude<EnvironmentPage, "connection">;
  sessionSettings: ReturnType<typeof useSessionSettings>;
  onInserted: () => void;
}) {
  useLocale();
  const { connection, sessions, drafts } = environment.runtime;
  const state = useStore(sessions);
  const connectionState = useStore(connection);
  const selectedId = state.selectedId;
  const thread = selectedId ? state.threads[selectedId] : undefined;
  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-muted break-words">
        {t("当前设备：{{name}}。", { name: environment.name })}
        {(page === "integrations" || page === "migration") &&
          (thread?.cwd
            ? t("工具按所选会话目录 {{v0}} 解析。", { v0: thread.cwd })
            : t("未选择会话，工具使用此设备的默认上下文。"))}
      </p>
      {page === "configuration" && (
        <>
          <SessionSettings
            settings={sessionSettings}
            models={connectionState.models}
            environmentName={environment.name}
          />
          <div className="border-t border-border pt-6">
            <EnvironmentTools connection={connection} group="configuration" />
          </div>
          <ProjectConfig connection={connection} sessionCwd={thread?.cwd} />
        </>
      )}
      {page === "integrations" && (
        <>
          <EnvironmentTools
            connection={connection}
            cwd={thread?.cwd}
            group="integrations"
            onInsertApp={
              selectedId
                ? (app) => {
                    drafts.addApp(selectedId, app);
                    environments.select(environment.id);
                    onInserted();
                  }
                : undefined
            }
          />
          {!selectedId && (
            <p className="text-xs text-muted">
              {t("选择或新建会话后，可将应用提及插入草稿。")}
            </p>
          )}
        </>
      )}
      {page === "migration" && (
        <ConfigMigration connection={connection} cwd={thread?.cwd} />
      )}
      {page === "attachments" && (
        <AttachmentSettings environment={environment} />
      )}
      {page === "files" && <FileSettings environment={environment} />}
    </div>
  );
}
