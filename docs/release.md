# 发布检查清单

## 自动发布

### 发布工具的可复现依赖修复

semantic-release 所依赖的 npm 11.21.1 捆绑了旧版 undici 与 ip-address，普通 overrides 不会替换其 tarball 内的代码。仓库将官方修复版 `undici@6.29.1` 和 `ip-address@10.7.4` 以开发依赖别名锁定，安装后执行 `npm run patch:release-tools`，实际替换捆绑文件并逐文件核验 SHA-256，最后同步审计元数据。

**每次 `npm ci` 或 `npm install` 后都必须执行补丁命令。** 仅修改锁文件不能修复 npm 的捆绑代码。`npm run check:release-tools` 会校验实际安装内容，未修复就失败；CI 和发布 job 都在审计之前应用并验证修复，不忽略任何审计告警。补丁只用于开发/发布工具，不进入用户安装的产品包。上游修复后应一起移除两个别名依赖、补丁脚本和流水线步骤。

日常发布入口是 `.github/workflows/release.yml`。推送 main 后先调用完整 CI（质量检查、依赖审计、构建、真实 npm 包安装烟测、生产浏览器测试），通过后运行 semantic-release。也可在 main 上手动运行 Release workflow；没有符合发布条件的新提交时不会生成新版本。

浏览器测试使用三个独立 runner，并通过 `--fully-parallel --workers=1` 按用例分片，每个 runner 内仍串行执行。当前 307 个用例分配为 103 / 102 / 102；原先按文件分片为 108 / 194 / 5，大测试文件导致总耗时取决于第二个 runner。调整不减少用例，不增加重试或跳过；实际提速以 Actions 耗时为准。

发布使用 Node.js 24 和 npm OIDC Trusted Publishing，无需在仓库长期保存 npm token。工作流只授予发布 job `contents: write` 与 `id-token: write`；不向 issue 或 PR 发送评论。发布串行执行，不取消正在发布的任务。

semantic-release 根据 Conventional Commits 自动决定版本，更新发布工作区的 package.json / lockfile，生成该版本 CHANGELOG.md，构建并发布 npm 包、创建 `vX.Y.Z` 标签和 GitHub Release，附上 `.tgz` 与更新日志。完整历史以 [GitHub Releases](https://github.com/vvebing/codex-workbench/releases) 为准。版本号与生成日志不回写 main，避免自动提交循环及绕过分支保护；仓库里的版本号不是最新发行版查询接口。首次没有历史标签时，semantic-release 默认从 **1.0.0** 开始。

### 首次启用（包所有者）

1. 确认 GitHub 仓库和 npm 包名均为 `vvebing/codex-workbench` / `codex-workbench`，并拥有发布权限。名称以 npm 实时查询结果为准。
2. 如 npm 尚无该包，先在干净检出中完成下方验证门禁，使用 npm 账户登录并执行 `npm publish --access public` 发布当前引导版本（0.1.0）；此操作会通过 prepack 构建产物。不要用空包占位。首次登录/2FA 由包所有者完成。
3. 在 npm 包 Settings → Trusted publishing 中添加 GitHub Actions：owner `vvebing`、repository `codex-workbench`、workflow filename **`release.yml`**，environment 留空（工作流未指定 environment）。勾选 **Allow npm publish** 与 **Allow npm dist-tag**，避免只允许暂存发布。按 npm 当前有效期要求及时完成首次可信发布。
4. 在 GitHub 启用 Actions，允许工作流创建发布标签与 Releases；配置 main 分支保护和 CI 必需检查，推荐只允许 squash 合并并使用 PR 标题作为提交信息。若标签规则限制创建 `v*`，需允许发布工作流执行。
5. 合并一个符合规范的 `feat:` 提交，或在已包含发布提交的 main 上运行 Release workflow。检查 npm 的 `latest`、GitHub Release、provenance 和打包附件，最后执行 `npx codex-workbench@latest --port 5181` 验收。

如已有合法发布版本，迁移前确认对应提交有正确的 `vX.Y.Z` 标签，不要为尚未发布的版本虚构标签。后续不手动 `npm version` 或 `npm publish`。

首次账户发布和创建 Trusted Publisher 都可能分别要求安全密钥/2FA 验证。不要只根据 CLI 的成功提示判断完成：需确认公开 registry 中真实版本、dist-tags 和 npx 入口。若仅看到 `0.0.0-stage` 占位版本，应检查 npm 的 Staged Packages 和元数据同步状态。

官方配置依据：[npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)、[semantic-release GitHub Actions](https://semantic-release.org/recipes/ci-configurations/github-actions/)。不要给 setup-node 设置 `registry-url`，以免生成的 npm 配置干扰 semantic-release 的 OIDC 认证。

### 本地验包与预演

```sh
npm ci
npm run patch:release-tools
npm run check
npm run build
npm run test:package
npm run release:dry-run
```

`test:package` 在临时目录安装真实 tarball，通过 npm exec 验证命令入口、帮助和版本，并从非项目目录验证端口、健康检查、SPA 页面和退出；使用 `--no-app-server`，不访问用户真实 Codex。`release:dry-run` 不发布，但仍需要远端仓库与认证，离线不能视为已验证发布。`npm pack` 自动构建；安装已发布包无需构建工具。运行依赖只有 `ws`，前端依赖已打包进静态文件。

发布失败时先核对 npm 版本和 GitHub 标签是否已存在；npm 已发布版本不能覆盖。不要删除已发布标签重试同版本。部分成功的发布按 semantic-release 的错误输出完成恢复，并通过新的修复提交发布后继版本。

## 发布范围

发行目标是单用户本机运行版本，不是互联网服务。保留现有按功能组织的源码、生成协议和分层测试；只交付构建所需源码或明确列出的运行产物。安全限制见 [SECURITY.md](../SECURITY.md)。

## 本次收尾验证（2026-10-16）

以下为用户确认冻结后的工作区实测记录，不代表后续版本持续通过。验证环境为 macOS、Node.js 22.22.3、npm 10.9.8、Codex CLI 0.162.1 和 Playwright Chromium。全量测试前后核对文件 SHA-256 清单与 Git 索引，均未变化；测试结束后仅更新本节记录。

- 提交内容检查覆盖 977 个文件；类型、ESLint、Prettier、431 项单元测试、18 项集成测试和生产构建通过。
- `npm audit --audit-level=low` 返回零已知漏洞。Monaco 的 DOMPurify 依赖已覆盖为补丁版；这不代表不存在未知漏洞或业务安全问题。
- 开发模式 Playwright 全量：142 通过、0 失败、1 预期跳过，耗时约 11.7 分钟。跳过的是仅适用于生产构建的分包加载用例。
- 生产模式 Playwright 全量：143 通过、0 失败、0 跳过，耗时约 9.3 分钟；包含真实编译产物的分包加载验收。
- 原阻断项已修复并回归：设置页严格验证四个分区；打开或恢复会话不提前取得写入权，发送时检查占用并保留草稿；Monaco diff view model 在编辑器销毁前显式解绑、释放，覆盖延迟计算取消及浏览器编辑、切换、关闭、重开场景。
- 冻结前开发验收曾出现三项连接／导航前置失败，并伴随并行文件修改及测试产物消失；这些结果不作为本次基线结论。冻结后的开发、生产完整运行均通过，没有新增重试或跳过来绕过失败。
- 子代理复核新增项目批量折叠和会话回退权限保护，未发现明确阻断；对应单元与浏览器测试随全量验收通过。
- `npm run test:app-server` 真实 CLI 非推理烟测通过，验证初始化、临时会话元数据、生产历史读取器和观察器；不恢复既有会话、不发起模型推理。
- 独立临时发行目录安装 337 个生产依赖后，编译入口从不同工作目录启动成功；健康检查、SPA 深链接、进程状态及 SIGTERM 关闭监听通过。入口烟测使用合成 Codex 子进程，不替代真实模型调用验收。
- 构建仍报告部分 chunk 超过 500 kB；构建完成，但性能优化不在本次安全收尾中展开。

**当前基线的自动化发布门禁已通过，原浏览器回归阻断已解除。** 结论仅适用于单用户本机版本，不代表已部署或适合公网、多用户运行。远端 SSH、真实认证与模型推理的端到端人工验收、目标平台 CI 仍不能标记完成。截图、trace 和错误上下文只保存在已忽略的 `test-results/`，不应提交。

## 源码与隐私检查

- 使用 `git status --short`、`git diff` 和 `git diff --cached` 分别审查工作区和暂存内容，不把“已忽略”等同于“已移除”。
- 执行 `npm run check:repository`；暂存最终版本后再执行一次。不要跳过索引中的报错，也不要把带秘密的扫描结果上传到公共日志。
- 人工复核七个批准的产品图标及其元数据；截图、真实附件和导出不进入源码或发布附件。
- 首次公开前检查历史与远端是否含秘密；内置检查只覆盖当前索引和未忽略工作区。泄露处理按安全说明先撤销凭据。
- 核实 README、使用指南、协议覆盖清单与实际行为一致。生成协议不要手工改写。

## 验证门禁

在干净检出中使用 Node.js 22.12+ 和锁定依赖：

```sh
npm ci
npm run patch:release-tools
npm audit --audit-level=low
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
E2E_PRODUCTION=1 npm run test:e2e
```

CI 执行质量检查、生产构建及生产模式浏览器测试，并通过 `npm audit --audit-level=low` 阻止已知依赖漏洞进入发行版；本机检查通过不替代目标平台验证。生产 E2E 启动器只加载编译产物，不启动或连接真实 Codex，且启用开发模式会跳过的分包测试。依赖审计需要访问 npm registry，失败或离线不能记录成“无漏洞”。不要在发布前直接运行 `npm audit fix --force`，升级依赖后重新完成测试。

可选 `npm run test:app-server` 会启动真实 Codex CLI 的非推理烟测。实际认证、模型推理、审批、文件修改、SSH 转发仍需在隔离测试项目中人工验证，不使用真实敏感数据。

## 构建交付与验收

仅复制以下内容到独立运行目录，不打包整个工作目录：

- `dist/client/` 和 `dist/server/`
- `package.json`、`package-lock.json`、`.npmrc`
- `README.md`、`SECURITY.md`、`docs/` 中的 Markdown 说明（保留文档链接）

在运行目录执行 `npm ci --omit=dev` 和 `npm start`。确认当前用户的 PATH 中有已配置好的 `codex`；缺少 CLI 时网页仍可启动，但不能自动提供本机 app-server。

验收 `GET /healthz`、首页、会话深链接与连接状态；健康检查只代表网页服务存活。确认只监听 loopback，且关闭网页服务后只停止它自己启动的 app-server。`PORT` 控制网页端口，不改变默认 app-server 的 4501 端口。

发布记录写明源码版本或工作区快照、Node/npm/Codex 版本、验证命令与真实结果、已知限制和人工验收情况。不要复用过期测试计数，也不要将 `test-results/` 中的 trace、截图或日志作为公开附件。

## 回退

保留上一版经过验证的运行产物和锁文件；停止当前网页服务后切回上一版并重新检查连接。不要把用户的浏览器数据、app-server 历史和认证文件包含进版本包或回退脚本。清除站点数据会丢失本地配置与队列，不是默认的回退步骤。
