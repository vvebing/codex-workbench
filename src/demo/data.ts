import { t } from "../lib/i18n";
import type { Thread } from "../generated/v2/Thread";
import type { ThreadItem } from "../generated/v2/ThreadItem";
import type { Turn } from "../generated/v2/Turn";
import type { Model } from "../generated/v2/Model";

export const DEMO_ENDPOINT = "wss://demo.invalid";
export const DEMO_PROJECTS = [
  "/demo/atlas-web",
  "/demo/design-system",
  "/demo/field-notes",
];
export const DEMO_FIRST_THREAD = "demo-thread-001";
export const now = () => Math.floor(Date.now() / 1000);
export const agent = (text: string): ThreadItem => ({
  type: "agentMessage",
  id: crypto.randomUUID(),
  text,
  phase: "final_answer",
  memoryCitation: null,
  delivery: null,
  questions: null,
});
export function makeTurn(text: string, answer: string): Turn {
  return {
    id: crypto.randomUUID(),
    rootTurnId: null,
    items: [
      {
        type: "userMessage",
        id: crypto.randomUUID(),
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      },
      agent(answer),
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: now() - 2,
    completedAt: now(),
    durationMs: 2000,
  };
}
export function makeThread(
  index: number,
  cwd = DEMO_PROJECTS[index % 3],
): Thread {
  const titles = [
    t("为项目列表添加搜索"),
    t("统一按钮与焦点状态"),
    t("整理 Markdown 导出流程"),
    t("修复窄屏导航布局"),
    t("补充深色主题"),
    t("完善空状态提示"),
  ];
  const title = titles[index % titles.length];
  return {
    id: `demo-thread-${String(index + 1).padStart(3, "0")}`,
    sessionId: crypto.randomUUID(),
    forkedFromId: null,
    parentThreadId: null,
    preview: t("请{{value0}}，并说明验证方法。", { value0: title }),
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "legacy",
    modelProvider: "demo",
    model: "demo-codex",
    reasoningEffort: "medium",
    createdAt: now() - index * 3600,
    updatedAt: now() - index * 1800,
    recencyAt: now() - index * 1800,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion: "demo",
    originator: "codex-workbench-demo",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: { sha: "1".repeat(40), branch: "demo/workbench", originUrl: null },
    name: title,
    turns: [
      makeTurn(
        t("请{{value0}}，并说明验证方法。", { value0: title }),
        t(
          "## {{value0}}\n\n这是使用真实工作台 UI 展示的虚构会话。你可以切换项目、查看文件、搜索会话，或发送消息体验预设回复。\n\n- 组件、编辑器和交互沿用正式工作台。\n- 文件与代码差异来自浏览器内的模拟服务。\n- 不调用模型，不执行真实终端命令，不访问本机文件。\n\n右侧「文件」面板可打开 README.md 和 src/ProjectList.tsx；「Git」面板可查看模拟代码变更。",
          { value0: title },
        ) +
          "\n\n" +
          t(
            "点击顶部终端图标可体验只读命令模拟，输入 help 查看示例；全部输出来自演示文件。",
          ),
      ),
    ],
  };
}
export const DEMO_MODEL: Model = {
  id: "demo-codex",
  model: "demo-codex",
  displayName: t("Demo Codex · 模拟模型"),
  description: t("预设回复，不调用模型"),
  upgrade: null,
  upgradeInfo: null,
  availabilityNux: null,
  modelSpecialty: null,
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: "medium", description: t("模拟回复") },
  ],
  defaultReasoningEffort: "medium",
  inputModalities: ["text"],
  supportsPersonality: false,
  multiAgentVersion: null,
  additionalSpeedTiers: [],
  serviceTiers: [],
  defaultServiceTier: null,
  availableAccessPrograms: null,
  isDefault: true,
};
export const ORIGINAL =
  'export const projects = ["atlas-web", "design-system", "field-notes"];\n\nexport function searchProjects() {\n  return projects;\n}\n';
export const MODIFIED =
  'export const projects = ["atlas-web", "design-system", "field-notes"];\n\nexport function searchProjects(query = "") {\n  const keyword = query.trim().toLowerCase();\n  return projects.filter(name => name.includes(keyword));\n}\n';
export function demoFiles() {
  return new Map(
    DEMO_PROJECTS.flatMap((cwd) => [
      [
        `${cwd}/README.md`,
        t(
          "# {{value0}}\n\n这是虚构的演示项目。\n\n可以在真实工作台编辑器内查看与修改这些文件。修改仅保存在本页模拟服务内，刷新后恢复。\n",
          { value0: cwd.split("/").at(-1) },
        ),
      ],
      [`${cwd}/src/ProjectList.tsx`, MODIFIED],
      [
        `${cwd}/docs/${t("示例 说明.md")}`,
        t(
          "# 演示说明\n\n这是带中文和空格路径的示例文件。\n只读终端可以查看、搜索这些内容；文件只存在于浏览器内。\n",
        ),
      ],
      [
        `${cwd}/logs/app.log`,
        "[demo] Loaded example files.\n[demo] Read-only terminal ready.\n",
      ],
      [
        `${cwd}/src/theme.css`,
        ":root {\n  --accent: #296346;\n  --surface: #f6f6f5;\n}\n",
      ],
      [
        `${cwd}/package.json`,
        JSON.stringify(
          {
            name: cwd.split("/").at(-1),
            private: true,
            scripts: { test: "echo demo" },
          },
          null,
          2,
        ) + "\n",
      ],
    ]),
  );
}
