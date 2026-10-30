# 设计工具

项目使用 [Impeccable](https://github.com/pbakaus/impeccable) 辅助界面设计与质量检查，入口为 [SKILL.md](../.agents/skills/impeccable/SKILL.md)。产品目标见 [PRODUCT.md](../PRODUCT.md)，设计令牌与组件规则见 [DESIGN.md](../DESIGN.md)。

## 工具来源

| 项目         | 值                                         |
| ------------ | ------------------------------------------ |
| 上游         | `pbakaus/impeccable`                       |
| 固定提交     | `5e745ace7e151feb2a93d360d0281fe39448b857` |
| 技能目录     | `.agents/skills/impeccable/`               |
| 引擎版本要求 | `0.1.18`，见 `scripts/VERSION`             |
| 授权与声明   | 技能目录内的 `LICENSE`、`NOTICE.md`        |

技能文件保留在项目中。引擎由其 launcher 查找或下载，不要求使用特定开发者的主目录或全局配置。

## 使用流程

先阅读技能入口和产品上下文。工作台属于 **Operate** 模式：优先保障任务操作、内容密度、明确状态和键盘可用性。每次界面编辑前读取技能要求的 craft floor，并按任务加载相应参考文件。

以下为给 agent 的技能指令：

```text
$impeccable shape 工作台的会话、文件、Git 和设置流程
$impeccable critique 工作台导航与主工作区
$impeccable audit 工作台主题、可访问性及窄屏布局
$impeccable polish 设置面板
```

在项目根目录获取上下文：

```sh
.agents/skills/impeccable/scripts/impeccable context
```

可通过 `--target` 指定组件文件。launcher 的引擎选择、下载和环境配置以技能内说明为准。

## 界面验收

检查中英文、浅深主题、桌面与窄屏布局，以及空态、加载、错误、键盘焦点和主要交互。浏览器检查以实际内容位置和操作行为为依据；工具已安装或静态检查通过不表示界面验收完成。

维护设计时同步更新产品约束和实际令牌，避免把设计文档写成一次任务的执行记录。截图应使用独立演示数据，不包含真实会话、凭据或私人路径。
