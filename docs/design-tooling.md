# 项目设计工具

本次工作台 UI 重构采用 **Impeccable**，安装在项目 `.agents/skills/impeccable/`。技能与参考文件进入仓库，便于审阅和复现；保留现有全局 `~/.impeccable` 运行时及配置。

## 选择依据

比较了两个仓库的实际 `SKILL.md`、使用流程和支持文件，而非只看首页示例。

| 工具                                                                                                     | 适用方式                                                                                                                           | 本项目判断                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Impeccable](https://github.com/pbakaus/impeccable/tree/5e745ace7e151feb2a93d360d0281fe39448b857) v4.8.0 | 区分 Operate、Read、Persuade、Experience；提供 shape、critique、audit、harden、polish 等定向流程，并读取产品、设计和具体界面上下文 | 适合现有多面板工作台的统一重构及后续质量检查，选择安装                                                          |
| [Hallmark](https://github.com/Nutlope/hallmark/tree/8f6969f8922caabde9de1784959eae11ddf68073) v2.0.0     | 默认从主题材料出发，带 scaffold、CSS stamp、静态及渲染检查；显式 redesign 保留内容和接线                                           | 也支持工具界面；App screens 分支会跳过 hero、营销词数和照片等规则。当前与另一套设计流程叠加收益有限，本次不安装 |

选择不代表 Hallmark 只适合营销页面。其 `references/flow.md` 的 App screens 分支有密度、状态、控件和任务界面的专门约束；这里优先采用更直接覆盖跨面板审阅与迭代的 Impeccable 命令。

## 来源和安装

- Impeccable 来源提交：`5e745ace7e151feb2a93d360d0281fe39448b857`。
- 上游技能路径：`.agents/skills/impeccable`。
- 本地入口：`.agents/skills/impeccable/SKILL.md`。
- 运行器要求：`scripts/VERSION` 为 `0.1.18`；已验证现有 `~/.impeccable/bin/0.1.18/impeccable` 返回 `impeccable-engine 0.1.18`。
- 安装器复制了 63 个技能及支持文件，已与该提交逐字节比对。另从同一提交保留 `LICENSE`、`NOTICE.md`，恢复 ZIP 解压丢失的 launcher 可执行位。
- 未执行全局安装、更新、hook 注册、agent 配置注册或 `init`。技能会在 Codex 下一轮发现时可用；当前会话也可以直接读取入口和参考文件。

通过系统 `skill-installer` 的 GitHub 安装脚本安装，命令如下（目标目录已存在时安装器会停止，不会覆盖）：

```sh
python3 /Users/vvebing/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo pbakaus/impeccable \
  --ref 5e745ace7e151feb2a93d360d0281fe39448b857 \
  --path .agents/skills/impeccable \
  --dest /Users/vvebing/study/codex-workbench/.agents/skills \
  --method download
```

## 本次重构如何使用

先读 `SKILL.md`；工作台采用 **Operate** 模式。整体替换视觉世界时读 `reference/new-work.md`，规划交互读 `reference/shape.md`，同时读 `reference/mode-operate.md` 和 `reference/operate.md`。每次开始 UI 编辑前读 `reference/craft-floor.md`，按请求再加载 `critique.md`、`audit.md`、`harden.md`、`adapt.md` 或 `polish.md`。

Codex 中可显式使用：

```text
$impeccable shape 工作台的会话、文件、Git 和设置流程
$impeccable critique 工作台导航与主工作区
$impeccable audit 工作台主题、可访问性及窄屏布局
$impeccable polish 设置面板
```

上面是给 agent 的技能命令，不是 shell 命令。`init` 是 agent 的产品上下文采集流程，会生成 `PRODUCT.md`；应先阅读其参考文件，结合现有代码和重构计划采集真实产品信息。`document` 用于记录 `DESIGN.md`。两者都不属于安装步骤。

在项目根目录加载一次会话上下文。当前机器复用已验证的现有引擎，并关闭本次更新和陈旧提示缓存检查，从而避免改动全局缓存：

```sh
IMPECCABLE_BIN=/Users/vvebing/.impeccable/bin/0.1.18/impeccable \
IMPECCABLE_NO_UPDATE_CHECK=1 \
IMPECCABLE_NO_STALENESS_CHECK=1 \
  .agents/skills/impeccable/scripts/impeccable context
```

可以给 `context` 加 `--target src/components/具体组件.tsx`。不指定 `IMPECCABLE_BIN` 时，上游 launcher 会依次探测内置、全局和缓存引擎，必要时下载；本次不需要下载。上述环境变量只对这一次命令生效，不修改用户配置。支持文件中的自定义 agent 定义已保留，但未注册到全局或项目 `.codex` 配置。

先用 `docs/ui-redesign-plan.md` 记录本项目取舍，真实运行结果和浏览器检查仍是验收依据；不要把已安装或已读参考文件当作界面验证通过。
