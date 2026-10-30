<p align="center">
  <img src="https://raw.githubusercontent.com/vvebing/codex-workbench/main/public/icons/product-icon.png" width="112" height="112" alt="Codex Workbench icon" />
</p>

# Codex Workbench

English · [简体中文](README.zh-CN.md)

A local-first, bilingual web workspace for Codex sessions, message queues, approvals, and subagent collaboration.

Organize conversations by project, work across local and remote environments, and review code beside your conversation. Tasks run through the Codex app-server in the selected environment.

![Projects, conversation, and editor in Codex Workbench](docs/images/workbench-overview.png)

Screenshots use fictional projects and conversations. The interface supports English and Simplified Chinese.

## Quick start

Requirements: **Node.js 22.12+** and an installed, authenticated **Codex CLI** available on your PATH.

```sh
npx codex-workbench@latest
```

Open **http://127.0.0.1:5180**. In **Settings → Environments**, connect to `ws://127.0.0.1:4501`, choose a project directory, and send your first message. The production service starts a local app-server or reuses an existing listener on port 4501.

To run from source:

```sh
git clone https://github.com/vvebing/codex-workbench.git
cd codex-workbench
npm ci
npm run patch:release-tools
npm run build
npm start
```

The web service listens on `127.0.0.1` for local, single-user operation. Connect remote execution environments through SSH forwarding; keep the workbench off public tunnels and reverse proxies. See [operations](docs/operations.md) and [security](SECURITY.md).

## What you can do

| Area          | Capabilities                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------- |
| Environments  | Connect local and SSH-forwarded machines; organize work by environment, project, and section |
| Conversations | Search history, favorite, fork, archive, and export sessions                                 |
| Execution     | Queue messages, steer active tasks, handle approvals and questions, follow subagents         |
| Context       | Reference files and skills, attach images and documents, set goals, request code reviews     |
| Files         | Browse, search, upload, download, and edit project files; preview Markdown and Mermaid       |
| Code review   | Inspect staged, unstaged, and untracked diffs; export patches and browse worktrees           |
| Preferences   | Choose English or Chinese, light or dark appearance, model settings, and panel sizes         |

<details>
<summary>Code review</summary>

![Side-by-side diff and Git status](docs/images/code-review.png)

</details>

<details>
<summary>Approvals and subagents</summary>

![Review a command before approving it](docs/images/approvals.png)

![Follow subagent output beside the parent conversation](docs/images/subagent-collaboration.png)

</details>

<details>
<summary>Task center</summary>

![Pending requests grouped by environment](docs/images/task-center.png)

</details>

## Documentation

Detailed guides are written in Simplified Chinese.

- [Documentation index](docs/README.md): find guides and technical references.
- [User guide](docs/user-guide.md): environments, conversations, queues, files, and saved data.
- [Operations](docs/operations.md): CLI options, production builds, SSH, macOS service, and troubleshooting.
- [Development](docs/development.md): architecture, local development, and validation.
- [Contributing](CONTRIBUTING.md), [release process](docs/release.md), and [security](SECURITY.md).
- [Product scope](PRODUCT.md), [design system](DESIGN.md), and [app-server coverage](docs/app-server-coverage.md).

## Development

```sh
npm ci
npm run patch:release-tools
npm run dev
```

In a separate terminal:

```sh
codex app-server --listen ws://127.0.0.1:4501
```

Development mode does not manage app-server. For validation:

```sh
npm run check
npm run test:e2e
npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

Install Chromium with `npx playwright install chromium` before the first browser test. E2E tests use isolated protocol stubs; run `npm run test:app-server` separately for a real app-server smoke test without inference. See [development](docs/development.md) for test scope and prerequisites.

## License

[MIT](LICENSE)
