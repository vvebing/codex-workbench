# 发布指南

Codex Workbench 发布为 npm 包和 GitHub Release，面向单用户本机运行。日常发布由 main 分支的 GitHub Actions 自动完成。

## 发布流水线

`.github/workflows/release.yml` 在 main 推送或手动触发时调用完整 CI，通过后运行 semantic-release。发布任务串行执行，不取消正在执行的发布。

CI 使用 Node.js 24，依次执行依赖补丁、依赖审计、质量检查、生产构建、真实 tarball 安装验证和生产浏览器测试。浏览器任务使用与锁文件精确版本匹配的 Playwright 官方容器，按用例分为三个 shard，每个 runner 一个 worker。

semantic-release 根据 Conventional Commits 决定版本：`fix:` 发布 patch，`feat:` 发布 minor，带 `!` 或 `BREAKING CHANGE:` 的提交发布 major。文档、测试和普通维护提交不单独触发发布；无待发布变更时不生成版本。

发布流程更新发布工作区中的版本与 CHANGELOG，执行构建并发布 npm 包，创建 `vX.Y.Z` 标签和 GitHub Release，附上 `.tgz` 与更新日志。版本和生成日志不回写 main。发行历史以 [GitHub Releases](https://github.com/vvebing/codex-workbench/releases) 为准。

## 发布权限

发布 job 具有 `contents: write` 和 `id-token: write`，通过 npm OIDC Trusted Publishing 认证，工作流不设置长期 npm token，也不向 issue 或 PR 发送发布评论。

包所有者需为 npm 包设置对应的 GitHub Trusted Publisher：

| 配置              | 值                             |
| ----------------- | ------------------------------ |
| GitHub owner      | `vvebing`                      |
| Repository        | `codex-workbench`              |
| Workflow filename | `release.yml`                  |
| Environment       | 留空，工作流未指定 environment |

确保允许正式发布和 dist-tag 更新；GitHub 标签规则需允许发布工作流创建 `v*`。main 应启用 CI 必需检查与分支保护。首次建立包与 npm 账户权限由包所有者完成；正常版本交由流水线管理，不手工修改版本或创建发行标签。

## 发布工具依赖

每次 `npm ci` 或 `npm install` 后执行：

```sh
npm run patch:release-tools
npm run check:release-tools
```

补丁脚本使用锁定的 `undici` 和 `ip-address` 开发依赖别名，替换发布工具 npm 内捆绑的对应文件，逐文件核验 SHA-256 并同步审计元数据。普通 overrides 无法替换 tarball 内的捆绑代码。CI 和发布 job 都在审计前执行补丁；补丁不进入产品运行依赖。

更新发布工具时复核是否仍需要补丁，联动调整别名依赖、脚本和工作流。Monaco 的 DOMPurify override 同样需随编辑器依赖升级复核。不要通过忽略审计结果或强制降级来完成门禁。

## 本地验证

在干净检出中运行：

```sh
npm ci
npm run ci
npx playwright install chromium
npm run ci:e2e
```

`ci` 已包括补丁、`npm audit --audit-level=low`、`check`、构建和 `test:package`。`ci:e2e` 使用生产模式，需要前一步的构建产物。

如需额外验证开发模式和真实协议：

```sh
npm run test:e2e
npm run test:app-server
```

真实协议烟测不发起模型推理。认证、模型调用、审批、文件修改与 SSH 需在隔离项目中人工验收。离线或审计失败不能记为审计通过。

`npm run release:dry-run` 可预览版本与发布说明，需要远端仓库和认证环境。记录预演结果时注明实际执行范围。

## 包与运行验收

`npm run test:package` 将真实 tarball 安装到临时目录，从非项目目录验证命令入口、帮助、版本、端口、健康检查、SPA 和退出流程。该验证使用 `--no-app-server`，不访问真实 Codex。

npm 包的交付范围由 `package.json` 的 `files` 字段控制，`prepack` 自动构建。打包前人工检查 `npm pack --dry-run` 输出，确认没有凭据、会话、附件、本机日志和测试产物。文档链接与批准的产品图像需保持有效。

独立源码构建的运行目录保留 `dist/`、`package.json`、`package-lock.json` 和 `.npmrc`，执行 `npm ci --omit=dev` 后运行 `npm start`。运行依赖以包清单为准，前端构建工具不需要进入运行环境。

验收应确认：

- CLI 帮助、版本与网页端口正常，`/healthz` 和 SPA 深链接可访问。
- 服务只监听 loopback，连接、审批与目标项目文件访问符合预期。
- 停止工作台只关闭它自己启动的 app-server，复用进程保持运行。
- npm `latest`、GitHub 标签、Release 附件与实际安装版本一致。

健康检查仅表示网页服务存活。安全与隐私检查见 [SECURITY.md](../SECURITY.md)。

## 发布记录与故障处理

发布记录包含源码提交、Node/npm/Codex 版本、验证命令与结果、人工验收范围和已知限制。不要沿用固定测试计数或将本机通过等同于远端 Actions 成功。

发布失败时先核对 npm 版本、dist-tag、GitHub 标签和 Release 是否已生成。npm 已发布版本无法覆盖，不删除公开标签重试相同版本；按失败阶段处理剩余步骤，必要时通过修复提交发布后继版本。

保留上一版经过验证的包与锁文件。恢复运行时先停止当前网页服务，再启动上一版并检查连接。用户浏览器数据、app-server 历史和认证文件不属于发行包；清除站点数据不是默认恢复步骤。
