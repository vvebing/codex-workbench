# 开发指南

本文说明代码组织、开发约束和验证方法。环境准备见[参与开发](../CONTRIBUTING.md)，运行边界与状态模型见[架构说明](architecture.md)。

## 目录结构

| 路径                                              | 职责                                            |
| ------------------------------------------------- | ----------------------------------------------- |
| `server/`                                         | HTTP 服务、WebSocket bridge、进程管理与入口校验 |
| `src/features/connection/`                        | 环境、连接、账户、模型与能力发现                |
| `src/features/sessions/`                          | 会话操作、历史读取、写入权限与轮询              |
| `src/features/composer/`                          | 输入、附件、草稿、提交与待发送队列              |
| `src/features/conversation/`                      | 时间线、Markdown、子代理观察与导出              |
| `src/features/requests/`、`approvals/`            | 服务端请求状态与审批界面                        |
| `src/features/files/`                             | 文件工作区、编辑器、恢复草稿与文件链接          |
| `src/features/navigation/`、`settings/`、`shell/` | 导航、设置、布局与 Git 工作区                   |
| `src/components/`                                 | 共享控件与界面 hooks                            |
| `src/lib/`                                        | RPC、状态归并、runtime 与共享基础能力           |
| `src/generated/`                                  | app-server 生成协议类型                         |
| `public/`                                         | 产品图标等静态资源                              |
| `scripts/`                                        | 构建、协议审计、仓库检查和发布工具              |
| `tests/`                                          | 单元、集成、浏览器、类型与烟测                  |
| `.github/workflows/`                              | CI 与自动发布                                   |

功能专用模型、样式和工具与 feature 放在一起。跨功能能力才进入共享目录。`dist/`、`output/`、`test-results/` 和本机日志属于生成产物。

## 开发与构建命令

| 命令                         | 用途                                        |
| ---------------------------- | ------------------------------------------- |
| `npm run dev`                | 启动 Vite 与同源 bridge，默认端口 5180      |
| `npm run dev -- --port 5182` | 指定开发端口                                |
| `npm run typecheck`          | 检查客户端和服务端类型                      |
| `npm run lint`               | ESLint，无警告通过                          |
| `npm run format:check`       | Prettier 格式检查                           |
| `npm run build`              | 类型检查、清理 dist、客户端打包和服务端编译 |
| `npm start`                  | 运行 `dist/server/index.js`                 |
| `npm run clean`              | 删除 dist                                   |

开发端口采用 `strictPort`，端口占用时启动失败。构建输出分别为 `dist/client/` 和 `dist/server/`。维护脚本使用 ESM `.mjs`，纳入 ESLint。

每次安装依赖后执行 `npm run patch:release-tools`；其校验与发布用途见[发布指南](release.md)。保留锁文件和 `.npmrc`，使用 `npm ci` 安装一致的依赖树。

## 协议与异步行为

业务 RPC 参数通过生成的 `ClientRequest` 和 `RpcCall` 绑定方法与参数。禁止用任意字符串透传或类型断言绕过协议契约；业务层不重复初始化连接。返回值使用对应生成类型。

异步状态修改需验证连接 epoch、选择 generation 或操作身份。读取历史不提前获取 writer，发送时确认写入能力。断线后的变更结果不确定时，不自动重复请求。对历史与事件归并的修改应覆盖乱序、重复事件和旧快照场景。

修改调用或通知处理后运行：

```sh
npm run audit:protocol
npm run check:protocol
```

前者更新[接口矩阵](app-server-interface-matrix.md)，后者验证生成文件一致性。`tests/types/rpc-contract.ts` 包含类型负例。接口范围见[协议覆盖](app-server-coverage.md)。

`src/generated/` 保留完整类型快照，不手工编辑或按引用裁剪。更新类型时先生成到临时目录、审阅差异，再替换快照。记录所用 CLI 版本，并执行完整检查；重点核对初始化、分页、writer 冲突、审批和临时线程。类型快照不代表运行时端点具有全部能力，客户端仍需遵守服务端能力结果。

## 界面实现

复用 `src/components/ui.tsx` 中的 Button、IconButton、Modal、Menu、SelectField 和 MultiSelectField。交互需支持键盘、焦点恢复和明确的加载、空、错误状态。提交中的文件弹窗通过 `dismissible` 阻止误关闭，浏览器离页保护使用 `beforeunload`。

主题变量集中于 `src/theme.css`，全局基础样式由 `src/styles.css` 管理。`src/main.tsx` 先导入样式再导入应用，保证 Tailwind 层顺序。使用语义颜色与现有字号角色，新增视觉层级先扩展 token。Monaco 和 Mermaid 共用 `src/lib/appearance.ts` 的外观解析。

界面文案同步英文和简体中文，不翻译用户输入、模型回复或文件内容。布局依据可用容器空间响应，避免仅依赖窗口宽度。设计原则和组件约定见 [DESIGN.md](../DESIGN.md)。

## 测试策略

| 层级         | 命令                                | 覆盖范围                                             |
| ------------ | ----------------------------------- | ---------------------------------------------------- |
| 单元         | `npm run test:unit`                 | Vitest 状态、模型、解析与功能逻辑                    |
| 集成         | `npm run test:integration`          | Node test runner、HTTP、bridge、WebSocket 与仓库工具 |
| 浏览器       | `npm run test:e2e`                  | Playwright 开发模式交互                              |
| 生产浏览器   | `E2E_PRODUCTION=1 npm run test:e2e` | 编译服务与客户端、生产分包                           |
| 真实协议烟测 | `npm run test:app-server`           | 真实 CLI 的非推理协议流程                            |
| 安装包       | `npm run test:package`              | 临时安装 tarball 后验证 CLI、HTTP 与退出             |

`npm test` 运行单元和集成测试。`npm run check` 还包含仓库、发布工具、发布语义、类型、协议矩阵、lint 和格式检查。

浏览器测试默认使用网页端口 5181 和随机端口的协议替身。首次本机运行先执行 `npx playwright install chromium`。生产测试前先运行 `npm run build`；专用启动器不启动、复用或读取用户真实 app-server。

按变更选择能验证行为的最小测试集；完整门禁使用 `npm run ci`，再运行 `npm run ci:e2e`。CI 的浏览器测试按用例分为三个 shard，每个 runner 使用一个 worker，容器镜像版本来自锁文件中的 Playwright 版本。

协议替身与非推理烟测不验证真实模型推理、执行审批、文件修改、远端认证或 SSH 稳定性。相关变更需在隔离项目中进行人工验收，并明确记录实际范围。测试截图、trace、日志留在忽略的产物目录，公开问题仅使用脱敏或合成数据。
