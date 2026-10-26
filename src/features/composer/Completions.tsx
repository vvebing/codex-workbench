import { t, useLocale } from "../../lib/i18n";
import { ScrollArea } from "../../components/ui";
import { useEffect, useState } from "react";
import type { CompletionToken } from "./completion-token";
import type { SkillMetadata } from "../../generated/v2/SkillMetadata";
import type { SkillsListResponse } from "../../generated/v2/SkillsListResponse";
import { searchWorkspaceFiles } from "./file-search";
import { useRuntime } from "../../lib/runtime-context";

export const commands = [
  {
    name: "help",
    get description() {
      return t("查看输入快捷键");
    },
  },
  {
    name: "new",
    get description() {
      return t("在当前目录新建会话");
    },
  },
  {
    name: "model",
    get description() {
      return t("选择模型与推理强度");
    },
  },
  {
    name: "permissions",
    get description() {
      return t("选择审批策略");
    },
  },
  {
    name: "skills",
    get description() {
      return t("浏览并选择技能");
    },
  },
  {
    name: "mention",
    get description() {
      return t("搜索工作目录文件");
    },
  },
  {
    name: "compact",
    get description() {
      return t("压缩当前会话上下文");
    },
  },
  {
    name: "status",
    get description() {
      return t("查看当前会话状态");
    },
  },
] as const;
export interface Completion {
  label: string;
  description: string;
  value: string;
  path?: string;
  skill?: Pick<SkillMetadata, "name" | "path">;
}
export function Completions({
  token,
  cwd,
  connected,
  selected,
  onSelect,
  onItems,
}: {
  token: CompletionToken;
  cwd: string;
  connected: boolean;
  selected: number;
  onSelect: (item: Completion) => void;
  onItems: (items: Completion[]) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const runtime = useRuntime();
  const [result, setResult] = useState<{
    key: string;
    items: Completion[];
    error?: string;
  }>({ key: "", items: [] });
  const key = JSON.stringify([token.prefix, token.query, cwd, connected]);
  const slashItems: Completion[] = commands
    .filter((c) => c.name.includes(token.query.toLowerCase()))
    .map((c) => ({
      label: `/${c.name}`,
      description: c.description,
      value: `/${c.name}`,
    }));
  useEffect(() => {
    if (token.prefix === "/" || !connected) return;
    let active = true;
    const timer = setTimeout(() => {
      const pending: Promise<Completion[]> =
        token.prefix === "$"
          ? runtime.connection.client
              .request<SkillsListResponse>("skills/list", {
                cwds: cwd ? [cwd] : [],
              })
              .then((response) => {
                const skills = response.data
                  .flatMap((entry) => entry.skills)
                  .filter(
                    (skill) =>
                      skill.enabled &&
                      skill.name
                        .toLowerCase()
                        .includes(token.query.toLowerCase()),
                  );
                return Array.from(
                  new Map(skills.map((skill) => [skill.path, skill])).values(),
                ).map((skill) => ({
                  label: `$${skill.name}`,
                  value: `$${skill.name}`,
                  description: skill.shortDescription || skill.description,
                  skill,
                }));
              })
          : cwd
            ? searchWorkspaceFiles(
                runtime.connection.client,
                cwd,
                token.query,
              ).then((files) =>
                files.map((file) => {
                  const path = `${file.root.replace(/[\\/]$/, "")}/${file.path}`;
                  return {
                    label: file.path,
                    path,
                    description: file.root,
                    value: /\s/.test(path) ? JSON.stringify(path) : path,
                  };
                }),
              )
            : Promise.reject(new Error(t("当前会话没有工作目录。")));
      void pending
        .then((items) => {
          if (active) setResult({ key, items });
        })
        .catch((error: unknown) => {
          if (active) setResult({ key, items: [], error: String(error) });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, token.prefix, token.query, cwd, connected, runtime]);
  const items =
    token.prefix === "/"
      ? slashItems
      : connected && result.key === key
        ? result.items
        : [];
  const serialized = JSON.stringify(items);
  useEffect(() => {
    onItems(JSON.parse(serialized) as Completion[]);
  }, [serialized, onItems, key]);
  return (
    <ScrollArea className="max-h-[min(16rem,calc(var(--viewport-height,100dvh)*0.25))]">
      <div
        id="composer-completions"
        role="listbox"
        aria-label={t("输入补全")}
        className="border-b border-border p-2"
      >
        <div className="px-2 py-1 text-fine text-subtle">
          {token.prefix === "/"
            ? t("快捷命令")
            : token.prefix === "$"
              ? t("技能")
              : t("工作目录文件")}{" "}
          <span className="max-[550px]:hidden">
            {t("· ↑↓ 选择 · Enter / Tab 确认 · Esc 关闭")}
          </span>
        </div>
        {items.map((item, index) => (
          <button
            key={`${item.value}-${item.skill?.path || index}`}
            id={`composer-completion-${index}`}
            type="button"
            role="option"
            aria-selected={selected === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(item)}
            className={`flex min-h-10 w-full min-w-0 items-center gap-3 rounded-md max-[550px]:flex-col max-[550px]:items-start max-[550px]:gap-0.5 px-2 py-2 text-left text-xs ${selected === index ? "bg-hover text-foreground" : "text-muted"}`}
          >
            <span className="min-w-0 max-w-full truncate" title={item.label}>
              {item.label}
            </span>
            <span className="min-w-0 max-w-full truncate text-subtle">
              {item.description}
            </span>
          </button>
        ))}
        {!items.length && (
          <p
            role="status"
            className="p-2 text-xs text-muted [overflow-wrap:anywhere]"
          >
            {token.prefix === "/"
              ? t("没有匹配的命令")
              : !connected
                ? t("连接后可读取列表")
                : result.key !== key
                  ? t("正在搜索…")
                  : result.error
                    ? t("读取失败：{{value0}}", { value0: result.error })
                    : t("没有匹配结果")}
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
