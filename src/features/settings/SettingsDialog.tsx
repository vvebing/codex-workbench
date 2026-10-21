import { useEffect, useState } from "react";
import { Tabs } from "radix-ui";
import { History, Plug, Plus, Settings2, Terminal } from "lucide-react";
import { ScrollArea, Button, Modal, SelectField } from "../../components/ui";
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
import { settingsSelectClass } from "./settings-ui";
import { AppServerTerminal } from "./AppServerTerminal";
import { ArchivedThreads } from "./ArchivedThreads";

const sections = [
  {
    value: "general",
    label: "通用",
    Icon: Settings2,
    description: "调整当前浏览器的显示与会话交互偏好。",
  },
  {
    value: "connections",
    label: "工作环境",
    Icon: Plug,
    description: "按设备管理连接、账号、模型配置和工具集成。",
  },
  {
    value: "activity",
    label: "已归档的会话",
    Icon: History,
    description: "按工作区查看已归档会话，恢复后可继续对话。",
  },
  {
    value: "terminal",
    label: "终端输出",
    Icon: Terminal,
    description: "查看网页服务自动启动的本机 Codex 进程输出。",
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
      title="连接与设置"
      variant="settings"
      returnFocusSelector='[data-settings-trigger], button[aria-label="打开导航"]'
      description="管理通用偏好、工作环境、已归档会话与终端输出。"
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
          className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 max-[900px]:grid max-[900px]:w-full max-[900px]:grid-cols-2 max-[900px]:border-r-0 max-[900px]:border-b"
          aria-label="设置分类"
        >
          {sections.map(({ value, label, Icon }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              disabled={connectionSettings.busy}
              className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-control text-muted hover:bg-hover data-[state=active]:bg-selected data-[state=active]:font-semibold data-[state=active]:text-accent max-[900px]:min-h-11 max-[900px]:justify-center max-[900px]:px-2 max-[550px]:text-xs"
            >
              <Icon
                className="max-[550px]:hidden"
                size={16}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">{label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <ScrollArea data-slot="settings-content" className="min-w-0 flex-1">
          <div className="min-w-0 space-y-6 p-6 [overflow-wrap:anywhere] max-[550px]:p-4">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="text-lg font-semibold">{current.label}</h3>
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
                  添加开发机
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
              {connectionSettings.selected && (
                <SelectField
                  label="工作环境设置"
                  className={settingsSelectClass}
                  value={environmentPage}
                  disabled={connectionSettings.busy}
                  options={[...environmentPages]}
                  onValueChange={(value) => {
                    setEnvironmentPage(value as EnvironmentPage);
                    connectionSettings.clearSensitive();
                  }}
                />
              )}
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
                <p className="text-xs text-muted">请选择已保存的工作环境。</p>
              )}
            </Tabs.Content>
          </div>
        </ScrollArea>
      </Tabs.Root>
    </Modal>
  );
}

const environmentPages = [
  { value: "connection", label: "连接与账户" },
  { value: "configuration", label: "模型与权限" },
  { value: "integrations", label: "工具与集成" },
  { value: "migration", label: "配置迁移" },
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
  const { connection, sessions, drafts } = environment.runtime;
  const state = useStore(sessions);
  const connectionState = useStore(connection);
  const selectedId = state.selectedId;
  const thread = selectedId ? state.threads[selectedId] : undefined;
  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-muted break-words">
        当前设备：{environment.name}。
        {page !== "configuration" &&
          (thread?.cwd
            ? `工具按所选会话目录 ${thread.cwd} 解析。`
            : "未选择会话，工具使用此设备的默认上下文。")}
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
              选择或新建会话后，可将应用提及插入草稿。
            </p>
          )}
        </>
      )}
      {page === "migration" && (
        <ConfigMigration connection={connection} cwd={thread?.cwd} />
      )}
    </div>
  );
}
