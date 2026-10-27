# 参与开发

使用 Node.js 24 LTS 开发和发布（运行已发布的工作台支持 Node.js 22.12+）。

```sh
npm ci
npm run patch:release-tools
npm run dev
```

开发时单独启动 Codex app-server，详见 [README](README.md)。`npm ci` 会自动安装仓库 Git 钩子，也可运行 `npm run hooks:install` 安装。每次 commit 前，钩子会将暂存区导出到临时目录，安装锁定依赖，并运行与 GitHub CI 共用的 `npm run ci` 和 `npm run ci:e2e`（安全审计、静态检查、单元/集成测试、生产构建、打包验证和完整生产模式 E2E）。任一步失败即阻止提交；部分暂存也只检查实际提交内容，不会 stash 或改动工作区。首次使用请运行 `npx playwright install chromium`，并确保能访问 npm registry。检查结束后临时目录会清理。

本地检查不能证明 GitHub 托管运行器上的 Actions 已成功；远端仍在推送后验证。Git 钩子可被 `--no-verify` 绕过，也不会随 clone 自动生效，团队还应使用分支保护要求 CI 成功才能合并。

手动验证可执行 `npm run ci && npm run ci:e2e`。浏览器验证见[开发文档](docs/development.md)。

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)。可以手写提交信息，或使用 Commitizen 向导：

```sh
git add <files>
npm run commit
```

`cz-conventional-changelog` 负责生成提交信息；semantic-release 根据这些信息决定版本并生成更新日志。

| 提交                                                            | 发布结果       |
| --------------------------------------------------------------- | -------------- |
| `fix(cli): validate port`                                       | patch          |
| `feat(cli): support custom port`                                | minor          |
| `feat!: remove deprecated option` 或正文中的 `BREAKING CHANGE:` | major          |
| `docs:`、`test:`、`chore:`、`ci:`、普通 `refactor:`             | 不单独触发发布 |

PR 标题同样遵循该规范，CI 使用 commitlint 检查。推荐在 GitHub 启用 **Squash merge**，并将默认 squash 提交信息设置为 PR 标题；破坏性变更在标题中使用 `!`，避免合并时丢失语义。如果选择保留多个提交，每个提交都应符合规范。直接推送 main 也必须遵守约定。

不要手工修改发布版本号、创建发布标签或提交生成的发布日志。版本与日志由 main 分支上的 semantic-release 管理；设置与首次发布步骤见[发布指南](docs/release.md)。

贡献按仓库的 [MIT License](LICENSE) 提供。
