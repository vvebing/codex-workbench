# App-server 接入范围

本表以仓库生成的 [`ClientRequest`](../src/generated/ClientRequest.ts) 为协议基准：共 **108 个请求方法**，当前业务代码已使用 **66 个请求方法**，另 **42 个明确暂缓**。这是代码接入数量，不代表每个服务端版本、账户或受管环境都能成功调用，也不把服务端通知、审批响应或声明的类型算成新请求。

统计方法：扫描 `src/` 中除 `generated/` 外的请求调用，包含分页辅助函数与 `writeRequest`、`threadRequest` 等封装，并与生成的方法集合交叉核对。连接初始化计入；用于工作目录、文件补全、文件监听和 Git 操作的后台请求也计入。同一方法被多个功能复用只计一次；文件树 Git 标记、Git 状态与差异查询复用已有接口，文件编辑与管理新增 5 个原生文件方法。后续增删请求时需同步调整。

产品用法见[使用指南](user-guide.md)，协议行为参照[官方 App-server 文档](https://learn.chatgpt.com/docs/app-server)。生成协议是本仓库实际类型依据，官方文档可能描述较新或不同版本的字段。

## 已接入：66 个

| 产品功能                 | 请求方法                                                                                                                                                                                                                                | 入口与边界                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 连接与模型（2）          | `initialize`、`model/list`                                                                                                                                                                                                              | 工作环境连接、模型目录分页。声明客户端实验 API 兼容能力以访问应用等接口；不修改服务端实验功能开关。                                      |
| 账户（6）                | `account/read`、`account/rateLimits/read`、`account/login/start`、`account/login/cancel`、`account/logout`、`account/rateLimitResetCredit/consume`                                                                                      | 环境账户、设备码／浏览器／API Key 登录、退出、套餐与用量、确认使用已有重置机会。用量读取失败不影响连接，不依据百分比或重置时间推断恢复。 |
| 会话历史与生命周期（13） | `thread/start`、`thread/resume`、`thread/read`、`thread/list`、`thread/turns/list`、`thread/items/list`、`thread/name/set`、`thread/archive`、`thread/unarchive`、`thread/fork`、`thread/revert`、`thread/delete`、`thread/unsubscribe` | 草稿首次发送、历史分页／搜索／补读、重命名、归档、分叉、回滚、永久删除和订阅释放。旧格式历史能力不同。                                   |
| 分类与置顶（6）          | `thread/metadata/update`、`thread/section/move`、`threadSection/create`、`threadSection/delete`、`threadSection/list`、`threadSection/update`                                                                                           | 置顶与侧栏分类管理。                                                                                                                     |
| 执行与审查（4）          | `turn/start`、`turn/steer`、`turn/interrupt`、`review/start`                                                                                                                                                                            | 发送、队列、立即引导、停止、会话内代码审查；写操作不自动重放。                                                                           |
| 上下文压缩（1）          | `thread/compact/start`                                                                                                                                                                                                                  | 输入区快捷命令触发压缩，由服务端执行。                                                                                                   |
| 会话目标（3）            | `thread/goal/get`、`thread/goal/set`、`thread/goal/clear`                                                                                                                                                                               | 会话工具中的目标、状态与可选 Token 预算；保存可能继续执行。                                                                              |
| 参考资料关联（4）        | `thread/attachment/add`、`thread/attachment/list`、`thread/attachment/remove`、`thread/attachmentOwner/list`                                                                                                                            | 名称、URL／路径与会话的关联记录、所属会话分页。不是上传或文件内容注入。                                                                  |
| 项目文件与补全（10）     | `fs/readDirectory`、`fs/readFile`、`fs/watch`、`fs/unwatch`、`fuzzyFileSearch`、`fs/writeFile`、`fs/createDirectory`、`fs/getMetadata`、`fs/remove`、`fs/copy`                                                                          | 目录树、搜索、Monaco 独立编辑工作区、会话文件链接定位、引用、保存冲突检查、新建、复制与确认删除；手机只读。                              |
| Git 查询（1）            | `command/exec`                                                                                                                                                                                                                          | 顶部分支与改动数、文件树状态标记、分组文件列表与 diff；目录树／列表切换、差异查看与刷新。                                                |
| MCP 管理（3）            | `mcpServerStatus/list`、`mcpServer/oauth/login`、`config/mcpServer/reload`                                                                                                                                                              | 状态分页、显式 OAuth 授权、重新加载磁盘配置；展示启动与登录通知。                                                                        |
| 配置诊断与有限编辑（3）  | `config/read`、`configRequirements/read`、`config/value/write`                                                                                                                                                                          | 只展示选定诊断字段；只允许修改默认模型与审批策略，有用户配置版本时使用版本校验。不提供任意配置／凭据编辑器。                             |
| 技能与 Hooks（4）        | `skills/list`、`skills/config/write`、`skills/extraRoots/set`、`hooks/list`                                                                                                                                                             | 技能错误、启停、进程级额外目录；Hooks 只读。监听技能变更。                                                                               |
| 应用（3）                | `app/list`、`app/read`、`app/installed`                                                                                                                                                                                                 | 可用／已安装应用与工具摘要、草稿中的显式应用提及。安装与工具执行不在此入口完成。                                                         |
| 外部配置迁移（3）        | `externalAgentConfig/detect`、`externalAgentConfig/import`、`externalAgentConfig/import/readHistories`                                                                                                                                  | 默认只探测所选目录；明确选择后写入，展示进度、完成与历史，支持通知先于响应。                                                             |

核算：2 + 6 + 13 + 6 + 4 + 1 + 3 + 4 + 10 + 1 + 3 + 3 + 4 + 3 + 3 = **66**。请求均可在 `src/features/` 和 [`src/lib/rpc.ts`](../src/lib/rpc.ts) 中定位。

## 明确暂缓：42 个

| 范围                            | 请求方法                                                                                                                                                                                                                                                                                                                | 暂缓原因与必要性                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 独立 Shell 与交互终端（4）      | `thread/shellCommand`、`command/exec/write`、`command/exec/terminate`、`command/exec/resize`                                                                                                                                                                                                                            | 需要终端会话、输入输出、尺寸和进程生命周期管理。当前运行固定 Git 查询，通用终端不是当前对话工作台的必要能力。            |
| 插件与市场（15）                | `marketplace/add`、`marketplace/remove`、`marketplace/upgrade`、`plugin/list`、`plugin/installed`、`plugin/reconcile`、`plugin/read`、`plugin/skill/read`、`plugin/install`、`plugin/uninstall`、`plugin/share/save`、`plugin/share/updateTargets`、`plugin/share/list`、`plugin/share/checkout`、`plugin/share/delete` | 涉及安装来源、权限、依赖、共享对象和磁盘变更，需要单独产品流程；当前展示技能、MCP 与应用即可。                           |
| MCP 通用资源／工具控制台（2）   | `mcpServer/resource/read`、`mcpServer/tool/call`                                                                                                                                                                                                                                                                        | 手工构造任意工具输入与资源读取需要专门表单及权限流程；当前由模型在正常任务中调用。                                       |
| 特殊账户与提供方（4）           | `account/gatewayOAuth/read`、`account/gatewayOAuth/login`、`account/gatewayOAuth/cancel`、`modelProvider/capabilities/read`                                                                                                                                                                                             | 专用网关登录与提供方能力诊断不是当前三种账户登录方式的必要补充。                                                         |
| 计费、工作区消息与营销操作（3） | `account/usage/read`、`account/workspaceMessages/read`、`account/sendAddCreditsNudgeEmail`                                                                                                                                                                                                                              | 累计 Token 活动和组织消息后续按需补充；发送邮件需要独立明确的组织操作流程。                                              |
| 实验功能与权限档案管理（3）     | `experimentalFeature/list`、`experimentalFeature/enablement/set`、`permissionProfile/list`                                                                                                                                                                                                                              | 客户端实验 API 能力声明不等于开启这些服务端功能。当前沿用服务端配置与受管策略，不增加全局实验开关。                      |
| Windows 沙箱设置（2）           | `windowsSandbox/setupStart`、`windowsSandbox/readiness`                                                                                                                                                                                                                                                                 | 属于宿主机安装／修复流程，当前工作台连接已运行的服务，不管理操作系统设置。                                               |
| 低层历史／运行控制（3）         | `thread/loaded/list`、`thread/inject_items`、`thread/approveGuardianDeniedAction`                                                                                                                                                                                                                                       | 普通历史和子代理读取已满足需求；直接注入历史或推翻拒绝决定不应作为通用 UI 暴露。                                         |
| 辅助写入与反馈（3）             | `config/batchWrite`、`externalAgentConfig/import/recordHistory`、`feedback/upload`                                                                                                                                                                                                                                      | 两项配置使用单值写入即可；导入历史由导入流程产生，不手工伪造；上传反馈需要单独说明收集内容和提交目标。                   |
| 旧版兼容请求（3）               | `getConversationSummary`、`gitDiffToRemote`、`getAuthStatus`                                                                                                                                                                                                                                                            | 分别已有当前历史、单轮变更／Git 工作区 diff 和账户读取路径；当前 Git 查询通过 `command/exec`，不调用 `gitDiffToRemote`。 |

核算：4 + **15** + 2 + 4 + 3 + 3 + 2 + 3 + 3 + 3 = **42**。

## 项目文件与 Git 的实现边界

项目面板分为「文件」「Git」「会话」，每轮执行结果留在对话底部。三种变更范围分别处理，不能互相代替：

| 展示范围       | 数据来源                                                | 语义与边界                                                                                                                                                          |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前仓库工作区 | `command/exec` 执行 Git status 与 diff                  | 顶部、Git 页和文件树共用状态；包含手工修改及其他会话产生的改动，不表示当前会话的贡献。已暂存与未暂存可以同时包含同一文件，顶部总数按文件计一次。                    |
| 当前项目文件树 | `fs/readDirectory`、`fuzzyFileSearch` 与 Git 状态       | 文件显示 `M/A/D/R/C/T/U/?` 标记、颜色和状态说明；目录汇总子树变更，冲突优先。通过仓库根目录映射子目录路径，重命名在同一子树只计一次；不伪造已删除文件的可打开条目。 |
| 单轮执行记录   | `turn/plan/updated`、`turn/diff/updated` 与该轮文件条目 | 按 `threadId + turnId` 隔离；汇总 diff（包括明确为空的 diff）优先，历史回退仅展示该轮已完成的文件操作，不将历史 patch 拼接称为会话累计净变更。                      |

文件浏览按目录逐层读取，搜索复用忽略规则过滤。文本预览限 UTF-8 且不超过 256 KB；这是客户端解码／展示限制，`fs/readFile` 仍返回完整文件内容，不是流式或分段读取。文件树使用监听和手动刷新；Git 状态另有轮次通知、页面焦点／可见性和可见页面定时刷新。当前状态缓存按连接、连接代次、作用域及工作目录隔离，尚未将同一仓库不同子目录合并为一个缓存键。

### Git 面板

Git 查询使用固定 argv 的 `command/exec` 和只读沙箱策略，关闭网络访问，并通过 `--no-optional-locks` 避免可选的索引更新。面板显示当前分支，按已暂存、未暂存、未跟踪和冲突状态分组展示文件，支持目录树／列表切换、刷新和文件差异查看。

文件树的忽略状态通过 `git check-ignore` 获取；编辑器行标记通过 `git ls-files` 和 `git cat-file` 读取暂存区基线；版本比较通过 `git rev-parse` 和 `git cat-file` 读取 Git 对象。查询使用所连接环境的 Git 和仓库读取权限。

实现位置：[Git 面板](../src/features/shell/GitPanel.tsx)、[共享 Git 状态](../src/features/shell/workspace-git.ts)、[文件树标记](../src/features/shell/tree-git.ts)、[单轮结果](../src/features/conversation/TurnResults.tsx)。端到端验证覆盖状态分组、差异查看、刷新和只读查询策略。

## 文件编辑与文件管理边界

文件树与会话 Markdown 文件链接统一打开主区域文件工作区，支持多个标签，并根据内容区域宽度在会话／编辑器分栏与单区域切换之间自适应；分隔线支持拖动和键盘调整，比例保存到浏览器。“专注编辑”可展开编辑区域，返回分栏或会话时保留编辑器实例、撤销记录、会话滚动位置与输入草稿。相对链接按来源会话（包括子代理）的工作目录解析，支持行列和行范围；历史变更的“打开当前文件”读取当前磁盘内容，历史 diff 保持原样。HTTP 等外部链接沿用链接过滤。

桌面端按需加载 Monaco 与本地 worker，提供语法高亮和基础编辑；没有引入完整 VS Code 扩展宿主或项目语言服务器。手机只读。当前支持不超过 256 KB 的 UTF-8 文本，保留 BOM 与换行；二进制、非 UTF-8 和超限文件显示不可编辑原因。`fs/readFile` 没有分段读取能力，因此大小限制是收到内容后的客户端保护。

Diff 与 Markdown 预览复用现有 Monaco、ReactMarkdown 及相关依赖，不新增 app-server 方法。未保存差异比较最近读取／保存的基线与编辑缓冲，冲突差异比较已读取的磁盘版本与缓冲；两者均不代表 Git HEAD／暂存区差异。普通编辑与 Diff 共用缓冲模型与撤销记录。Markdown 支持编辑、预览和分屏，相对文件链接按文档所在目录解析；本地图片目前提示占位。

普通文件编辑视图的左侧显示 Git 行标记：绿色为新增、蓝色为修改、红色三角为删除。标记比较暂存区与当前编辑缓冲，包含未保存草稿；仅已暂存且草稿与暂存区相同时不显示标记。悬停查看原内容，点击进入差异视图；未跟踪文件以空内容为基线。基线随 Git 状态刷新，输入时仅在本地计算差异。冲突、子模块、非文本或超限基线不显示标记并提示不可用。

Git 页点击未暂存、已暂存或未跟踪文件，会在主编辑区打开只读 Diff 预览标签；点击文件行右侧的“打开当前文件”图标可直接打开工作区文件，并保留已有的未保存草稿。已删除文件的打开图标置灰，仍可点击文件名查看差异。Diff 预览标签使用斜体文件名，连续查看不同文件时复用一个临时标签；双击标签或点击“固定当前标签”可保留它。普通文件编辑使用固定标签，已有草稿不会被预览替换。未暂存比较暂存区与磁盘文件，已暂存比较 HEAD 与暂存区，未跟踪以空文件为基线；重命名使用原路径读取 HEAD，删除以空的新版本展示。快照不包含未保存草稿，可重新加载更新，也可点击“编辑当前文件”返回原编辑缓冲。冲突文件打开当前文件处理。版本内容通过已有 `command/exec` 只读命令获取，不新增协议方法。

编辑缓冲按环境及文件绝对路径隔离，切换会话、面板和连接不会直接丢弃未保存内容。文件监听与轮询发现外部修改时，未修改的缓冲刷新，已修改的缓冲提示冲突。保存前重新读取并比较基线；冲突可比较、重新加载或另存为。超时或断线后的写入不自动重放。未保存文件参与离页保护，并阻止相关删除；刷新或关闭页面仍会丢失内存缓冲。

新建和复制前用 `fs/getMetadata` 检查目标，已有目标不覆盖。删除明确提示永久删除及路径，并显式传递 `force: false` 与所需的 `recursive`。原生协议没有版本条件写入、排他创建或原子移动接口；保存和目标检查只能减少竞态，不能保证其他进程同时写入时的原子冲突保护。重命名／移动暂缓，不用复制后删除模拟原子移动。文件保存通过 `fs/writeFile` 执行，使用连接环境的文件写入权限；保存失败时显示错误并保留未保存草稿。此次在独立临时目录通过真实 app-server 验证了 metadata、写入、读取、新建目录、复制、删除；目标不存在返回 `No such file or directory (os error 2)`。探测还确认原生 `fs/copy` 会覆盖已有文件，因此 UI 的目标存在检查不可省略；该检查仍非原子保证。

实现位置：[文件状态与操作](../src/features/files/store.ts)、[编辑工作区](../src/features/files/FileWorkspace.tsx)、[链接解析](../src/features/files/file-links.ts)。

## 通知、审批与协议外范围

审批、权限请求、用户问题和 MCP elicitation 属于服务端请求的响应，不增加上述 `ClientRequest` 数量。工作台也处理会话／轮次／条目更新、单轮计划与汇总 diff、文件系统变更、账号与用量更新、警告与模型重路由、MCP 启动／OAuth、技能／应用变更和迁移进度／完成等通知。结构化计划与汇总 diff 来自实时通知，当前历史 `Turn` 没有直接恢复这两项的字段；刷新后不能保证恢复，也不会用其他轮次的数据补齐。

实时音视频、远程控制、预测、部分进程和平台专属通知可能存在于生成类型或官方文档中；本版本没有相应 UI，也没有为了达到接口数量而启用它们。此处的 108 方法统计仅针对仓库当前生成的 `ClientRequest`，不把通知名称误算成可调用方法。

可选端点不支持、实验接口被服务端拒绝或账户权限不足时，显示对应功能错误并保留其他功能。断线或切换环境后忽略旧回复；超时的写操作不自动重试，需先核实服务端结果。
