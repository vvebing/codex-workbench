# 参与开发

Codex Workbench 使用 TypeScript、React 和 Node.js。开发与发布使用 Node.js 24；发行包的运行要求为 Node.js 22.12+。

## 准备环境

```sh
npm ci
npm run patch:release-tools
npx playwright install chromium
```

在两个终端分别启动协议服务和网页：

```sh
codex app-server --listen ws://127.0.0.1:4501
```

```sh
npm run dev
```

打开 `http://127.0.0.1:5180`，在工作环境设置中连接 app-server。开发服务不管理 app-server 进程。目录职责、状态约束和测试策略见[开发指南](docs/development.md)与[架构说明](docs/architecture.md)。

## 完成一项变更

1. 明确用户可观察的行为，将代码放入对应 feature；共享能力放入 `src/lib/` 或 `src/components/`。
2. 为行为变化补充适当的单元、集成或浏览器测试。文案与低风险文档变更检查格式、链接和事实即可。
3. 同步用户指南、接口清单和相关设计约定；产品界面文案同时提供英文与简体中文。
4. 检查工作区与暂存差异，确认没有凭据、真实会话、附件或本机产物。
5. 运行相关验证，在 PR 中说明行为、验证结果和已知限制。

完整本地门禁：

```sh
npm run ci
npm run ci:e2e
```

`ci` 应用发布工具补丁、审计依赖，执行全部质量检查、构建和真实 tarball 安装验证；`ci:e2e` 使用生产构建执行浏览器测试。先完成 `ci` 再运行 `ci:e2e`。依赖安装和审计需要访问 npm registry。

## Git 钩子

仓库中的 `npm ci` 会安装 `.githooks`，也可运行 `npm run hooks:install`。已有其他 `core.hooksPath` 时，需先整合钩子配置。

提交前钩子把暂存内容导出至临时仓库，安装锁定依赖并执行 `npm run ci` 和 `npm run ci:e2e`。部分暂存只验证将被提交的内容，不改变工作区或依赖目录；检查后清理临时目录。请预先安装 Chromium。任一检查失败会阻止提交。

本地钩子可被绕过，远端 CI 仍是合并门禁。维护者应为 main 配置必需检查和分支保护。

## 提交与 PR

提交信息和 PR 标题遵循 Conventional Commits。可使用交互向导：

```sh
git add <files>
npm run commit
```

| 类型                                                | 发布影响       |
| --------------------------------------------------- | -------------- |
| `fix(scope): description`                           | patch          |
| `feat(scope): description`                          | minor          |
| `feat!: description` 或正文中的 `BREAKING CHANGE:`  | major          |
| `docs:`、`test:`、`chore:`、`ci:`、普通 `refactor:` | 不单独触发发布 |

PR 描述先说明具体问题与最终行为，再给出验证结果。推荐 squash 合并并保留 PR 标题的提交语义。版本号、发布标签和发行更新日志由 semantic-release 管理，流程见[发布指南](docs/release.md)。

贡献按 [MIT License](LICENSE) 提供。安全问题按[安全说明](SECURITY.md)中的私密报告方式处理。
