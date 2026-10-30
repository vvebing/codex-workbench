# app-server 功能范围

本项目通过 Codex app-server 执行任务。协议类型来自 [`src/generated/`](../src/generated/ClientRequest.ts)，业务接入以实际请求调用为准。仓库协议包含 **108 个客户端方法、10 个服务端请求和 86 个通知**，业务代码调用其中 **67 个客户端方法**。

[接口逐项清单](app-server-interface-matrix.md)列出字段、响应类型与源码位置；[协议约定](protocol.md)说明握手、写入、审批和验证边界。静态引用只说明代码接入，不保证目标账户、策略或服务器提供对应能力。

## 已接入：67 个

| 产品功能                 | 请求方法                                                                                                                                                                                                                                | 入口与边界                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 连接与模型（2）          | `initialize`、`model/list`                                                                                                                                                                                                              | 工作环境连接、模型目录分页。声明客户端 experimentalApi 能力以访问应用等接口；不修改服务端实验功能开关。                                  |
| 账户（6）                | `account/read`、`account/rateLimits/read`、`account/login/start`、`account/login/cancel`、`account/logout`、`account/rateLimitResetCredit/consume`                                                                                      | 环境账户、设备码／浏览器／API Key 登录、退出、套餐与用量、确认使用已有重置机会。用量读取失败不影响连接，不依据百分比或重置时间推断恢复。 |
| 会话历史与生命周期（13） | `thread/start`、`thread/resume`、`thread/read`、`thread/list`、`thread/turns/list`、`thread/items/list`、`thread/name/set`、`thread/archive`、`thread/unarchive`、`thread/fork`、`thread/revert`、`thread/delete`、`thread/unsubscribe` | 草稿首次发送、历史分页／搜索／补读、重命名、归档、分叉、回滚、永久删除和订阅释放。历史读取遵循服务端声明的 historyMode。                 |
| 分类（5）                | `thread/section/move`、`threadSection/create`、`threadSection/delete`、`threadSection/list`、`threadSection/update`                                                                                                                     | 侧栏分类管理；当前协议不支持持久置顶。                                                                                                   |
| 执行与审查（4）          | `turn/start`、`turn/steer`、`turn/interrupt`、`review/start`                                                                                                                                                                            | 发送、队列、立即引导、停止、会话内代码审查；写操作不自动重放。                                                                           |
| 上下文压缩（1）          | `thread/compact/start`                                                                                                                                                                                                                  | 输入区快捷命令触发压缩，由服务端执行。                                                                                                   |
| 会话目标（3）            | `thread/goal/get`、`thread/goal/set`、`thread/goal/clear`                                                                                                                                                                               | 会话工具中的目标、状态与可选 Token 预算；保存可能继续执行。                                                                              |
| 参考资料关联（4）        | `thread/attachment/add`、`thread/attachment/list`、`thread/attachment/remove`、`thread/attachmentOwner/list`                                                                                                                            | 名称、URL／路径与会话的关联记录、所属会话分页。不是上传或文件内容注入。                                                                  |
| 项目文件与补全（10）     | `fs/readDirectory`、`fs/readFile`、`fs/watch`、`fs/unwatch`、`fuzzyFileSearch`、`fs/writeFile`、`fs/createDirectory`、`fs/getMetadata`、`fs/remove`、`fs/copy`                                                                          | 目录树、搜索、Monaco 独立编辑工作区、会话文件链接定位、引用、保存冲突检查、新建、复制与确认删除；手机只读。                              |
| Git 与项目命令（3）      | `command/exec`、`command/exec/write`、`command/exec/terminate`                                                                                                                                                                          | Git 只读查询、补丁导出和已有 worktree 选择；项目命令流式日志、标准输入与停止。Git 操作仅提供读取与补丁导出。                             |
| MCP 管理（3）            | `mcpServerStatus/list`、`mcpServer/oauth/login`、`config/mcpServer/reload`                                                                                                                                                              | 状态分页、显式 OAuth 授权、重新加载磁盘配置；展示启动与登录通知。                                                                        |
| 配置诊断与有限编辑（3）  | `config/read`、`configRequirements/read`、`config/value/write`                                                                                                                                                                          | 只展示选定诊断字段；只允许修改默认模型与审批策略，有用户配置版本时使用版本校验。不提供任意配置／凭据编辑器。                             |
| 技能与 Hooks（4）        | `skills/list`、`skills/config/write`、`skills/extraRoots/set`、`hooks/list`                                                                                                                                                             | 技能错误、启停、进程级额外目录；Hooks 只读。监听技能变更。                                                                               |
| 应用（3）                | `app/list`、`app/read`、`app/installed`                                                                                                                                                                                                 | 可用／已安装应用与工具摘要、草稿中的显式应用提及。安装与工具执行不在此入口完成。                                                         |
| 外部配置导入（3）        | `externalAgentConfig/detect`、`externalAgentConfig/import`、`externalAgentConfig/import/readHistories`                                                                                                                                  | 默认只探测所选目录；明确选择后写入，展示进度、完成与历史，支持通知先于响应。                                                             |

核算：2 + 6 + 13 + 5 + 4 + 1 + 3 + 4 + 10 + 3 + 3 + 3 + 4 + 3 + 3 = **67**。请求均可在 `src/features/` 和 [`src/lib/rpc.ts`](../src/lib/rpc.ts) 中定位。

## 未提供的接口：41 个

| 范围                            | 请求方法                                                                                                                                                                                                                                                                                                                | 产品边界                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 独立 Shell 与交互终端（2）      | `thread/shellCommand`、`command/exec/resize`                                                                                                                                                                                                                                                                            | 项目命令已有输入、输出及停止；完整终端还需要终端仿真与尺寸管理，目前不提供。                                             |
| 插件与市场（15）                | `marketplace/add`、`marketplace/remove`、`marketplace/upgrade`、`plugin/list`、`plugin/installed`、`plugin/reconcile`、`plugin/read`、`plugin/skill/read`、`plugin/install`、`plugin/uninstall`、`plugin/share/save`、`plugin/share/updateTargets`、`plugin/share/list`、`plugin/share/checkout`、`plugin/share/delete` | 涉及安装来源、权限、依赖、共享对象和磁盘变更，需要单独产品流程；当前展示技能、MCP 与应用即可。                           |
| MCP 通用资源／工具控制台（2）   | `mcpServer/resource/read`、`mcpServer/tool/call`                                                                                                                                                                                                                                                                        | 手工构造任意工具输入与资源读取需要专门表单及权限流程；当前由模型在正常任务中调用。                                       |
| 特殊账户与提供方（4）           | `account/gatewayOAuth/read`、`account/gatewayOAuth/login`、`account/gatewayOAuth/cancel`、`modelProvider/capabilities/read`                                                                                                                                                                                             | 专用网关登录与提供方能力诊断不是当前三种账户登录方式的必要补充。                                                         |
| 计费、工作区消息与营销操作（3） | `account/usage/read`、`account/workspaceMessages/read`、`account/sendAddCreditsNudgeEmail`                                                                                                                                                                                                                              | 不提供累计 Token 活动、组织消息与营销邮件入口。                                                                          |
| 实验功能与权限档案管理（3）     | `experimentalFeature/list`、`experimentalFeature/enablement/set`、`permissionProfile/list`                                                                                                                                                                                                                              | 客户端实验 API 能力声明不等于开启这些服务端功能。当前沿用服务端配置与受管策略，不增加全局实验开关。                      |
| Windows 沙箱设置（2）           | `windowsSandbox/setupStart`、`windowsSandbox/readiness`                                                                                                                                                                                                                                                                 | 属于宿主机安装／修复流程，当前工作台连接已运行的服务，不管理操作系统设置。                                               |
| 低层历史／运行控制（4）         | `thread/metadata/update`、`thread/loaded/list`、`thread/inject_items`、`thread/approveGuardianDeniedAction`                                                                                                                                                                                                             | 元数据接口不声明置顶字段；普通历史和子代理读取已满足需求；直接注入历史或推翻拒绝决定不应作为通用 UI 暴露。               |
| 辅助写入与反馈（3）             | `config/batchWrite`、`externalAgentConfig/import/recordHistory`、`feedback/upload`                                                                                                                                                                                                                                      | 两项配置使用单值写入即可；导入历史由导入流程产生，不手工伪造；上传反馈需要单独说明收集内容和提交目标。                   |
| 其他协议请求（3）               | `getConversationSummary`、`gitDiffToRemote`、`getAuthStatus`                                                                                                                                                                                                                                                            | 分别已有当前历史、单轮变更／Git 工作区 diff 和账户读取路径；当前 Git 查询通过 `command/exec`，不调用 `gitDiffToRemote`。 |

核算：2 + **15** + 2 + 4 + 3 + 3 + 2 + 4 + 3 + 3 = **41**。

## 文件与 Git

文件树、文件管理和编辑器通过 `fs/*` 方法访问所连接环境。文本查看上限默认 8 MB，完整编辑默认 1 MB，简化编辑默认 5 MB；差异每个版本默认上限 8 MB。具体限制见[使用指南](user-guide.md)。读取采用整文件传输，客户端限制不能当作服务端分段读取保证。

保存前核对磁盘基线，新建和复制前检查目标；这些检查与写入之间不是原子操作。协议未提供 compare-and-swap、排他创建或原子移动，因此并发写入仍需用户核对。

Git 面板通过 `command/exec` 执行固定参数的只读查询，禁用网络访问与可选索引锁。支持状态分组、文件差异、补丁导出及已有 worktree 选择。暂存、提交、推送、PR 和 worktree 创建不属于工作台功能。

仓库状态与轮次变更分别展示：仓库状态包括人工及其他会话的修改；轮次变更按 `threadId + turnId` 隔离，优先采用该轮汇总 diff。文件操作累计行数不表示最终净变更。

## 服务端请求与通知

交互界面处理命令审批、文件审批、同步问题、权限审批与 MCP elicitation。其他服务端请求返回未知方法错误，不自动同意。审批选项遵循服务端声明，权限批准限定在申请范围内。

通知用于驱动轮次、条目、目标、账户与环境工具状态。逐项清单中的处理位置是代码引用，不代表所有通知字段均被消费。未提供实时音视频、完整终端、插件市场安装或通用 MCP 调试控制台。

## 维护清单

```sh
npm run audit:protocol
npm run check:protocol
npm run typecheck
```

新增功能时核对生成参数、空值与省略语义、响应字段、分页、服务端通知和失败状态。接口方法数量由生成清单校验；此页的产品分组应随功能变更更新。
