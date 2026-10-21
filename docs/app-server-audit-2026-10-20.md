# app-server 接口对接审计（2026-10-20）

## 结论与范围

修复前不能认定对接完全符合协议：存在未声明的置顶字段、无参数请求序列化错误、用户操作来源遗漏、通知未消费、配置版本过期和归档来源筛选不一致。原有测试还用模拟服务支持不存在的置顶字段，掩盖了真实协议差异。

本次检查了浏览器 RPC、桥接、会话/轮次/历史、账户、文件/Git、环境工具、配置迁移、目标/附件、审批及通知处理。新增的 [逐项清单](app-server-interface-matrix.md) 列出仓库协议的 **108 个客户端方法、10 个服务端请求、86 个通知**，包含顶层请求字段、响应字段和调用位置。修复后业务调用 **65 个方法**，其余 **43 个未接入**；移除无效置顶调用使数量从 66 降到 65，并不意味着失去已可用的服务端功能。

字段“完整”指当前功能发送所有必要字段、正确处理需要的返回语义；不意味着把所有可选字段填满，也不意味着所有返回字段都应显示在界面。参数互斥、联合类型分支、空值与省略的区别仍以生成定义为准。

## 依据与版本边界

- [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)：核对握手、生成协议、实验能力、会话/轮次生命周期、分页和双向请求。官方文档是滚动更新的，不能替代目标二进制的字段契约。
- 仓库 `src/generated/`：本次生产调用和静态检查的类型基准，未手工修改生成文件。
- 本机 `codex-cli 0.163.0`：分别执行 `generate-ts`、`generate-ts --experimental` 和 `generate-json-schema --experimental`，输出到临时目录用于比较。
- 该二进制默认生成 108 个方法；带 `--experimental` 实际生成 **175 个方法、11 个服务端请求、87 个通知**。因此“108”只是仓库快照范围，不能称为完整实验协议覆盖率。附录逐项列出额外的 67 个方法。
- 与本机默认生成结果相比，仓库仍有 `ThreadListParams/Response`、`ThreadReadResponse`、内容/音频类型等差异，并缺少 `ThreadReadState` 相关类型。实验输出还多出 `currentTime/read` 服务端请求和 `thread/readState/changed` 通知。此次未将审计扩展为协议整体升级。
- 两种本机生成模式都不包含 `ThreadMetadataUpdateParams.isPinned`，也没有 `Thread.isPinned`。即使滚动文档提及相关过滤字段，也不能推导出本机提供置顶写入能力。

## 已确认问题与修复

| 优先级 | 问题与影响                                                                                                                                         | 本次处理                                                                                                               | 回归证据                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P1     | RPC 接受任意 `string` 方法和 `unknown` 参数；缺字段、拼写错误及接口错配绕过类型检查                                                                | 从 `ClientRequest` 派生 `RpcCall` 联合元组；会话写入、文件修改、历史分页、搜索和环境工具统一沿用；握手方法不向业务开放 | `tests/types/rpc-contract.ts` 检查错误方法、缺少 `input`、错配字段、重复初始化和无参数端点 |
| P1     | `thread/metadata/update` 发送不存在的 `isPinned`；模拟服务自行添加该字段                                                                           | 停止发送该请求，菜单明确置顶暂不可用，模拟服务拒绝该字段；覆盖文档将该方法转入暂缓                                     | 会话管理单测及菜单 E2E                                                                     |
| P1     | `request` 默认参数 `{}` 把显式 `undefined` 和省略参数也变为对象，影响 `configRequirements/read`、`config/mcpServer/reload`、导入历史读取及退出账户 | 保留 `undefined`，让 JSON 序列化省略 `params`；退出账户不再传 `{}`；需要对象的请求仍必须显式传对象                     | RPC 线格式测试、账户/配置/迁移测试                                                         |
| P1     | 清除目标时未传 `origin`；协议明确省略来源不等于用户授权                                                                                            | `thread/goal/clear` 显式发送 `origin: "user"`，与设置目标一致                                                          | `thread-tools.test.ts`                                                                     |
| P2     | 忽略 `account/rateLimits/updated`，用量快照可能长期落后                                                                                            | 将稀疏通知作为快照失效信号，重新读取完整账户用量；合并并发刷新并丢弃通知前发起的旧读                                   | 稀疏通知、连续通知合并及旧回复测试                                                         |
| P2     | `config/value/write` 后继续保留旧 `origins.version`，连续写入容易错误冲突；并发旧读取还可能覆盖新状态                                              | 写成功后失效旧配置并重新读取；旧请求的成功和错误均按序号忽略，后续保存使用新版本                                       | 连续版本 v1→v2 保存、并发旧读取失败测试                                                    |
| P2     | 主列表显式包含 `appServer` 来源，归档列表却依赖服务端默认来源，可能漏掉本工作台创建的会话                                                          | 归档首屏与后续分页统一复用 `ROOT_THREAD_SOURCES`                                                                       | 归档恢复及分页 E2E                                                                         |
| P3     | `HistoryDialog` 没有任何入口引用，仍保留旧归档查询/恢复逻辑，且分页和筛选弱于现行实现                                                              | 删除无入口组件，保留设置页 `ArchivedThreads`                                                                           | 类型检查、归档 E2E                                                                         |

## 按功能核对请求与响应语义

以下结论与逐项清单配合阅读；“未发现字段错误”只代表本次静态审阅与所列验证范围，不代表对所有账户和平台执行过真实操作。

| 范围                             | 核对结果与必要边界                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize` / `model/list`      | 每条连接只握手一次，等待响应后发送 `initialized`，再允许业务请求。启用实验能力、不声明 attestation 能力。模型列表消费所有分页并防游标循环；模型目录不等于账户可用性保证。                                                               |
| 账户六个方法                     | 登录处理提前到达的完成通知；取消关联 `loginId`；退出参数已修复。账户读取和完整用量快照分离，重置额度使用明确的信用项与幂等键；不从百分比或重置时间推断 `ordinaryUsageAllowed`。额度写入超时不自动重放。                                 |
| 会话生命周期十三个方法           | 创建只在草稿首次发送时发生；读取历史不调用 resume。写入前取得 writer，resume 使用 `threadId`、`excludeTurns`；fork 支持边界轮次。revert 检查历史模式、活动轮次及 writer，不把回滚说成磁盘撤销。删除、归档和断线处理防止旧回复复活会话。 |
| 历史 `turns/list` / `items/list` | 显式 `itemsView`、方向、游标；按 `historyMode` 选择分页或旧历史读取；临时会话不强行读取持久历史。单轮补读保留 item 生命周期。`backwardsCursor` 未使用，当前采用固定方向分页；这是功能选择而非漏传必填字段。                             |
| 分类五个方法                     | 列表有分页循环保护，创建与更新现在使用分别关联的参数元组，更新必须提供 `sectionId`。移动使用 `null` 表示取消分类；删除后同步本地关联。置顶与分类不是同一个协议能力。                                                                    |
| 执行四个方法                     | `turn/start` 具备 `threadId` 与 `input`；`turn/steer` 传活动轮次的 `expectedTurnId`；interrupt 指向明确轮次；review 使用 inline delivery。请求响应不代表执行完成，最终状态由通知驱动，迟到的 start 响应不能覆盖已完成轮次。             |
| 压缩与目标四个方法               | 压缩是请求启动，不能把返回成功当成所有执行已结束。目标设置校验目标/预算；设置与清除均声明用户来源；读取和目标通知用版本隔离。清除响应的 `cleared` 未用于差异化提示，界面统一收敛到无目标。                                              |
| 附件四个方法                     | 引用是元数据关联，不是上传内容；创建保留 `created`/已存在语义。删除只允许本工作台的 attachment type；所属会话查询传 type、identity、归档条件与分页。手动分页的循环保护仍有改进项，见下节。                                              |
| 文件十个方法                     | 路径、base64 数据和递归/force 参数按契约传递；watchId 绑定连接，旧连接监听不在新连接释放。读取限制属于客户端展示限制。保存前读基线、新建/复制前查存在均非原子；协议没有提供 CAS 写入、排他创建或原子移动，不能宣称消除并发覆盖。        |
| `command/exec`                   | 固定 argv 的 Git 查询使用只读策略、禁网、超时与返回 exitCode；流式 stdout 未启用，所以读取最终 stdout 合法。完整对象内容先查大小，不能把客户端 RPC 超时等同于服务端进程已经取消。                                                       |
| MCP 三个方法                     | 状态列表分页；OAuth 按 name/loginId 匹配通知，处理通知先于响应；重载无参数。没有实现任意资源/工具手工调用，不把生成类型算成已接入。                                                                                                     |
| 配置三个方法                     | 配置来源与 requirements 分开读取，编辑字段白名单为模型和审批策略；有用户来源版本时发送 `expectedVersion`、`filePath`。保存后刷新版本；受管理层覆盖时展示 overriddenMetadata 提示。                                                      |
| 技能/Hooks 四个方法              | 按所选 cwd 查询，技能修改传 path/enabled；额外目录是整个列表替换，界面说明不写入磁盘；Hooks 仅读取。                                                                                                                                    |
| 应用三个方法                     | 列表、已安装项、详情分别查询；详情明确请求工具信息。未提供插件安装/市场写入流程，不把应用发现称为安装支持。                                                                                                                             |
| 配置迁移三个方法                 | 检测明确 cwds/includeHome；导入仅发送勾选项目并带来源；按 importId 关联进度与完成，缓存早到事件并合并 itemTypeResults；写失败先检查历史，不自动重试导入。                                                                               |

## 双向请求、通知与剩余改进项

服务端请求有 5 种实际 UI 支持：命令审批、文件审批、同步问题、权限审批、MCP elicitation。其余 5 种仓库协议请求返回 `-32601`，不自动同意：动态工具调用、外部 ChatGPT Token 刷新、attestation 和两种旧版审批。当前没有声明动态工具或 attestation 能力；登录流程也未提供外部 Token 托管。实验版新增 `currentTime/read` 仍落入未知请求拒绝路径。

命令审批使用服务端 advertised decisions，规则和网络修改必须匹配提出的修订；权限只允许请求范围的子集。MCP URL 限 HTTP(S) 且禁止内嵌凭据，表单按支持的 schema 校验；未声明扩展表单支持。RPC 请求和响应的 ID 分开处理，服务端请求不会因为与客户端 ID 相同而误完成客户端 Promise；已响应请求和 `serverRequest/resolved` 去重。

仍需保留以下限制，不能据此宣称“所有接口、所有字段、所有环境已完全验证”：

1. **响应类型仍由调用方指定。** 请求参数现已在共享边界校验，但 `request<T>` 的返回类型仍是类型断言，传输层没有完整 JSON Schema 运行时验证。已逐项列出响应字段并审阅当前消费；后续应从同版本协议生成 method→response 映射，逐步替代手写 `{ thread: Thread }` 等投影。初始化的 platform 字段、会话响应的所有配置字段及 history backwards cursors 等并未全部消费，不能把“字段存在于类型”视作 UI 支持。
2. **协议版本尚未整体对齐。** 仓库缺少快照来源版本/生成参数的机器可读记录；`experimentalApi: true` 也不保证所有实验特性在目标服务器启用。升级应整体再生成、审阅差异及真实验证，不能手写不存在的字段兼容它。
3. **附件分页保护不一致。** `thread/attachment/list` 和 `thread/attachmentOwner/list` 采用手动分页，缺少跨页 seen-cursor 防环；owner 追加也没有去重。不会自动无限请求，但重复游标会让“加载更多”无法推进。MCP/app 分页只防相邻重复，未防更长循环；后续宜提取统一的游标检查器。
4. **问题响应的 Store 边界已补强。** 后续交互修复为 `item/tool/requestUserInput` 增加完整问题 ID 集合与非空字符串数组校验，防止绕过表单提交缺失答案。同步回答保留私密字段脱敏的提交摘要；异步答案使用 `clientUserMessageId` / `clientId` 关联问题，普通追问不再使旧问题失效。旧服务端无关联字段且标题有歧义时保留问题，不猜测已回答状态。
5. **通知不是全部消费。** 逐项清单明确标记无处理引用的通知；实时媒体、进程等没有相应产品功能。`skills/changed` / `app/list/updated` 在该资源读取中到达时会遇到 busy 提前返回，未采用用量刷新新增的 dirty-follow-up 机制，存在短暂陈旧风险。不能用 opt-out 隐藏通知来伪装覆盖。
6. **不会从重连推断写成功或自动重放。** 元数据写入、配置修改、文件保存和 turn/start 的超时结果仍可能不确定；这应保留为产品行为，而非用无条件重试“修复”。只读刷新和有明确定义的额度幂等键需分别处理。

## 重复逻辑审阅

- 已删除无入口的旧归档实现，并把局部环境工具参数校验并入共享 RPC 约束。
- 保留会话历史 reader 与只读 agent observer 的复用；observer 不取得 writer，不能直接与写会话路径合并。
- Git 状态、版本内容、忽略规则虽然都调用 `command/exec`，查询语义不同，不是重复功能；继续共用状态缓存，避免把工作区差异冒充某会话的贡献。
- 文件图片的多个展示入口复用 `imageDataUrl`，但仍各自触发读取；后续可按环境代次+绝对路径合并短期请求，不能共享跨环境文件缓存。
- 账户登录完成通知与 account/updated 都可能触发账户读取；旧回复已有序号保护，但账户读取本身未做与用量读取相同的并发合并。属于优化项，不能把不同账户的读合成同一个缓存。
- 不建议把所有分页都抽成自动“读完所有页”：用户驱动的更多、历史窗口、搜索和后台发现有不同加载范围，应只复用游标校验/去重等共性。

## 验证与复查

- 请求契约负例纳入 `npm run typecheck`；逐项清单通过 `npm run audit:protocol` 更新，`npm run check:protocol` 检查是否过期，并纳入 `npm run check`。
- 单元测试覆盖请求序列化、生命周期、写入幂等/不重放、配置版本和通知竞态；集成测试覆盖本机桥接和模拟服务。
- 真实 `codex-cli 0.163.0` 冒烟已通过：生产 RPC 初始化、模型/账户读取、临时只读会话创建、生产历史读取和 agent observer；没有调用模型、没有恢复已有会话。它不是 65 个接口的真实端到端验证。
- 登录、额度消费、配置写入、导入、删除等使用模拟服务测试，未对用户真实账户/配置执行这些写操作。
- 完整 `npm run check` 通过：仓库检查、类型检查（含契约负例）、清单一致性、ESLint、Prettier、79 个单测文件中的 534 项测试和 18 项集成测试。集成测试需要在允许监听本机端口的环境运行。
- 选取 16 项浏览器回归，首轮 15 项通过、1 项在进入会话前断线；固定源码后重跑该项及归档相关的 4 项均通过。归档测试又增加了 `sourceKinds` 请求断言；为此补全模拟服务的 `thread/list` 参数记录并单独验证。没有把这组检查称作全量 E2E。
- 真实冒烟另验证 `configRequirements/read` 无参数请求成功。清单中的源码位置会随格式化变化，提交前重新生成。

## 附录：本机实验协议额外方法

下表所有方法均不在当前仓库 `ClientRequest` 快照中，也没有生产 RPC 调用。按完整实验协议统计时，65 个调用之外还有 43 个快照内暂缓方法及这 67 个方法；三者总计 175。它们不是“必需全部补齐”的产品需求，启用前应先明确流程、能力与测试。

| 方法                                        | 对接状态                                   |
| ------------------------------------------- | ------------------------------------------ |
| `account/bedrock/checkGovCloudRequirements` | 未接入；需先更新实验协议快照及设计对应流程 |
| `account/bedrock/discover`                  | 未接入；需先更新实验协议快照及设计对应流程 |
| `account/bedrock/setup`                     | 未接入；需先更新实验协议快照及设计对应流程 |
| `collaborationMode/list`                    | 未接入；需先更新实验协议快照及设计对应流程 |
| `environment/add`                           | 未接入；需先更新实验协议快照及设计对应流程 |
| `environment/info`                          | 未接入；需先更新实验协议快照及设计对应流程 |
| `environment/status`                        | 未接入；需先更新实验协议快照及设计对应流程 |
| `fuzzyFileSearch/sessionStart`              | 未接入；需先更新实验协议快照及设计对应流程 |
| `fuzzyFileSearch/sessionStop`               | 未接入；需先更新实验协议快照及设计对应流程 |
| `fuzzyFileSearch/sessionUpdate`             | 未接入；需先更新实验协议快照及设计对应流程 |
| `mcpServer/event/stream/start`              | 未接入；需先更新实验协议快照及设计对应流程 |
| `mcpServer/event/stream/stop`               | 未接入；需先更新实验协议快照及设计对应流程 |
| `memory/reset`                              | 未接入；需先更新实验协议快照及设计对应流程 |
| `memory/status`                             | 未接入；需先更新实验协议快照及设计对应流程 |
| `mock/experimentalMethod`                   | 未接入；需先更新实验协议快照及设计对应流程 |
| `plugin/search`                             | 未接入；需先更新实验协议快照及设计对应流程 |
| `process/kill`                              | 未接入；需先更新实验协议快照及设计对应流程 |
| `process/resizePty`                         | 未接入；需先更新实验协议快照及设计对应流程 |
| `process/spawn`                             | 未接入；需先更新实验协议快照及设计对应流程 |
| `process/writeStdin`                        | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/create`                            | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/delete`                            | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/import`                            | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/list`                              | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/move`                              | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/read`                              | 未接入；需先更新实验协议快照及设计对应流程 |
| `project/update`                            | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/client/list`                 | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/client/revoke`               | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/disable`                     | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/enable`                      | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/pairing/start`               | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/pairing/status`              | 未接入；需先更新实验协议快照及设计对应流程 |
| `remoteControl/status/read`                 | 未接入；需先更新实验协议快照及设计对应流程 |
| `rollout/compress`                          | 未接入；需先更新实验协议快照及设计对应流程 |
| `server/diagnostics`                        | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/backgroundTerminals/clean`          | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/backgroundTerminals/list`           | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/backgroundTerminals/terminate`      | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/decrement_elicitation`              | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/increment_elicitation`              | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/items/read`                         | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/memoryMode/set`                     | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/prediction/request`                 | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/queue/add`                          | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/queue/delete`                       | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/queue/list`                         | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/queue/reorder`                      | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/queue/start`                        | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/queue/update`                       | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/readState/update`                   | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/realtime/appendAudio`               | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/realtime/appendSpeech`              | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/realtime/appendText`                | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/realtime/listVoices`                | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/realtime/start`                     | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/realtime/stop`                      | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/search`                             | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/searchOccurrences`                  | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/settings/update`                    | 未接入；需先更新实验协议快照及设计对应流程 |
| `thread/timeline/list`                      | 未接入；需先更新实验协议快照及设计对应流程 |
| `turn/settings/update`                      | 未接入；需先更新实验协议快照及设计对应流程 |
| `userVerification/cancel`                   | 未接入；需先更新实验协议快照及设计对应流程 |
| `userVerification/delete`                   | 未接入；需先更新实验协议快照及设计对应流程 |
| `userVerification/enroll`                   | 未接入；需先更新实验协议快照及设计对应流程 |
| `userVerification/status`                   | 未接入；需先更新实验协议快照及设计对应流程 |
| `userVerification/verify`                   | 未接入；需先更新实验协议快照及设计对应流程 |
