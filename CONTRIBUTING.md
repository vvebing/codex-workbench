# 参与开发

使用 Node.js 24 LTS 开发和发布（运行已发布的工作台支持 Node.js 22.12+）。

```sh
npm ci
npm run patch:release-tools
npm run dev
```

开发时单独启动 Codex app-server，详见 [README](README.md)。提交前执行 `npm run check`；涉及生产服务或打包时执行 `npm run build && npm run test:package`。浏览器验证见[开发文档](docs/development.md)。

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
