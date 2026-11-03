# app-server 协议约定

工作台的请求类型以 [`src/generated/`](../src/generated/ClientRequest.ts) 为准。[功能范围](app-server-coverage.md)说明产品入口，[接口逐项清单](app-server-interface-matrix.md)提供字段、响应类型和调用位置。类型声明和静态调用数量不等于目标环境的功能保证。

当前快照由 Codex CLI **0.166.0** 的 `codex app-server generate-ts --out ./src/generated` 生成，未包含 `--experimental` 的额外方法与字段。握手声明 `experimentalApi` 与生成实验类型是两件事。

## 连接与请求

[`RpcClient`](../src/lib/rpc.ts) 为每条连接执行一次 `initialize`，响应后发送 `initialized`，再开放业务请求。客户端声明 `experimentalApi: true`、`requestAttestation: false`；能力声明不改变服务端功能开关或账户权限。

业务方法和参数由 `ClientRequest` 派生的联合元组约束。无参数方法保留 `undefined`，序列化时省略 `params`；需要空对象的方法显式传 `{}`。省略、空对象与 `null` 的含义由具体协议类型决定。

响应泛型由调用方声明，传输层不执行完整 JSON Schema 校验。消费者需要校验实际使用的字段，并分别处理方法不存在、认证、策略、参数和其他错误。连接能力记录来自真实调用证据，重新连接后重置。

客户端请求 ID 与服务端请求 ID 分开处理。连接作用域、代次与请求序号用于隔离迟到响应，避免旧连接结果覆盖当前状态。

## 会话与执行

- 草稿首次发送时创建会话；浏览历史使用读取接口，写入前取得会话 writer。
- 历史按服务端 `historyMode` 选择读取路径，分页保留游标、轮次及条目身份。
- `turn/start` 的响应表示请求被接受；轮次完成状态由通知驱动。
- `turn/steer` 指定 `expectedTurnId`，中断也指向明确轮次。
- 回滚改变会话历史，不表示撤销磁盘文件修改。
- 目标设置与清除显式传入 `origin: "user"`。
- 条目生命周期时间为毫秒，轮次时间为秒；历史内联生命周期完整时直接恢复，旧服务端保留 `thread/items/list` 回退。缺失时间不能推断为零或覆盖已有完成状态。
- 历史追加可开启独立的 `excludedThreadIds` 分页链；同链固定排除集合且最多 100 个合法线程 ID。元数据刷新不排除现有会话；旧服务端拒绝可选字段时只降级该参数，不将整个方法判定为不支持。
- 审查仅使用 `delivery: "inline"`。未来独立审查应先创建线程，再在目标线程启动审查。

写请求不会在断线或超时后自动重放。结果不确定时先读取服务端状态并交由用户核实。浏览器请求超时不表示服务端进程已停止；命令停止通过独立的终止请求执行。

## 审批与问题

界面支持命令审批、文件审批、同步问题、权限审批和 MCP elicitation。其余服务端请求返回 `-32601`，不会自动批准。已响应请求与 `serverRequest/resolved` 去重。

命令审批遵循服务端给出的 decisions；规则和网络修订必须匹配原申请。权限响应只能批准申请范围内的子集。MCP URL 限 HTTP(S)，拒绝内嵌凭据；表单按支持的 schema 校验。

同步问题在 Store 边界检查完整问题 ID 与非空答案。异步回答使用消息身份关联问题，队列显示排队、发送、失败和待核实状态。无法确定问题已回答时保留问题，避免根据普通追问猜测。

## 文件、配置与环境工具

文件接口采用整文件传输。保存前基线检查、新建前存在性检查不具备原子性；不承诺排除并发覆盖。文件大小和 diff 计算限制见[使用指南](user-guide.md)。

配置编辑只开放默认模型与审批策略。有用户配置版本时使用 `expectedVersion`；写入后重新读取配置及版本。受管理层覆盖时显示相应提示。

账户登录、MCP OAuth 和外部配置导入分别按标识关联通知，支持完成通知先于请求响应的时序。参考资料关联接口只记录名称和路径等元数据；实际附件上传由工作台的文件传输流程处理。

通知按功能选择消费，不宣称所有字段均在界面展示。通知引用位置见生成清单。

图片生成结果按 `fileId` / `result` 分支处理，优先使用 `savedPath`。文件 ID 不作为文件路径或下载 URL；生成来源路径和 SHA-256 只代表当次读取记录。旧记录缺少新字段时保持可读。

`hooks/list({ threadId })` 仅查询已加载会话，不同时传 `cwds`，不因查看工具而取得 writer。`hook/started` 与 `hook/completed` 按线程隔离，并防止晚到的开始事件回退已完成状态。

`account/usage/read({ threadId })` 的 `nativeUsageUsdMicros`、估算美元及积分独立展示，`null`/省略表示未知。生成类型的 bigint 在 JSON 中也可能表现为 number；客户端拒绝不安全整数的精确金额展示，避免错误舍入。账户变化使费用及其在途请求失效。

`feedback/save` 是显式写入，路径属于 app-server 主机且必须尚未使用，日志按用户选择。超时或断线不自动重放；页面内按连接、作用域和线程保留待核实路径，下载与导出串行执行。网页通过 `fs/readFile` 取回 ZIP，沿用 8 MB 下载上限；整文件传输仍可能触及 bridge 消息上限。

新增 `ThreadReadState` 通知与 `AccountSession` 类型尚未形成当前快照中的完整读写／切换接口，因此未提供跨客户端已读同步或多账户切换。`ApplicationStorageRequirements` 不是文件访问限制；`process/exited.outputDrainTimedOut` 不适用于现有 `command/exec` 流程。加密响应、音色和保留工具输出等底层类型变化不额外开放入口。

## 检查与验证

```sh
npm run audit:protocol
npm run check:protocol
npm run typecheck
npm run test:app-server
```

清单由 TypeScript 类型与业务源码生成，不应手工编辑。类型检查包含 [`tests/types/rpc-contract.ts`](../tests/types/rpc-contract.ts) 的错误调用样例。单元与集成测试验证线格式、竞态和失败处理；真实 app-server 烟测验证实际连接及读取路径，不代表所有账户写入操作均已验证。

修改协议快照时，应成套生成类型、检查参数和响应差异、更新业务调用及模拟服务，并对涉及的真实能力单独验证。
