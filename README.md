<p align="center">
  <img src="https://raw.githubusercontent.com/vvebing/codex-workbench/main/public/icons/product-icon.png" width="112" height="112" alt="Codex Workbench icon" />
</p>

# Codex Workbench

English · [简体中文](README.zh-CN.md)

**A bilingual workspace for Codex sessions, task queues, approvals, and subagent activity.**

Organize projects, track execution, and review code changes in your browser. Connect local development environments and remote machines through SSH forwarding. The workbench runs locally and executes tasks through Codex app-server.

[User guide (中文)](docs/user-guide.md) · [Releases](https://github.com/vvebing/codex-workbench/releases) · [Contributing (中文)](CONTRIBUTING.md) · [Security (中文)](SECURITY.md)

Licensed under the [MIT License](LICENSE).

## Product tour

**Go from task discussion to code review in one workbench.** Organize sessions by project, connect multiple environments, and view conversations, the editor, and project files side by side.

![Codex Workbench with project sessions, a conversation, and the code editor side by side](docs/images/workbench-overview.png)

All captures use fictional projects, conversations, and code in an isolated environment. No real development data is shown. The interface shown is Simplified Chinese; English is also available. Click an image for full size, or expand a workflow below.

<details>
<summary>Review code changes: compare lines and distinguish staged, unstaged, and untracked files</summary>

![Code review with a side-by-side diff and files grouped by Git status](docs/images/code-review.png)

</details>

<details>
<summary>Control execution: inspect the command, reason, and directory before granting approval</summary>

![Command approval with the test command, working directory, and allow, deny, or cancel actions](docs/images/approvals.png)

</details>

<details>
<summary>Follow subagent work: inspect live output and handle approvals beside the parent conversation</summary>

![Parent conversation beside subagent details, command output, and an approval request](docs/images/subagent-collaboration.png)

</details>

<details>
<summary>Handle pending work in one place: see requests by environment and jump to the source conversation</summary>

![Task center grouping parent and subagent approval requests by local and remote demo environments](docs/images/task-center.png)

</details>

## Features

| Feature                     | What you can do                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Multiple environments       | Connect local and remote machines; organize sessions by environment, project, and section       |
| Sessions and history        | Search, favorite, fork, and archive sessions; copy or export Markdown                           |
| Message queues              | Keep drafting while tasks run, queue messages, track delivery, and recover failed drafts        |
| Approvals and collaboration | Handle approvals, answer requests, and track subagent activity and task progress                |
| Code and context            | Reference files and skills, inspect diffs, set session goals, and request code reviews          |
| File workspace              | Upload and download project files, reveal the active file, and reference files or selected code |
| Local operation             | Start with one npx command; automatically start or reuse a local app-server                     |
| English and Chinese         | Follow your browser language or choose a language in Settings                                   |

The conversation and editor appear side by side when the main area is at least 960px wide, initially sharing the space equally. Drag the divider to save a new ratio; double-click it or press Enter to restore equal widths. The file panel can follow the active editor, and you can reveal files from the editor toolbar or a tab's context menu.

Upload multiple files or download individual files up to 8 MB each. For duplicate names, replace the existing file, keep both, or cancel. When downloading a file with unsaved changes, save it first or download the version on disk.

Attach images and other files to the composer, up to 5 MB each, or drag project files from the file tree to reference them. Uploaded and pasted attachments, including images, are stored in `~/.codex-workbench/attachments/<upload-id>/` in the connected execution environment. Set a custom directory per environment in **Settings → Environments → Attachment storage**, using `~/...` or an absolute path. Preferences are stored in the current browser and apply to future uploads. Non-image attachments are referenced by their absolute path. Removing a reference leaves the file in place; document parsing depends on the tools available in the execution environment.

The editor opens UTF-8 files up to 8 MB. Files up to 1 MB support full editing; larger files up to 5 MB use simplified plain-text editing, and files above 5 MB are read-only. Simplified mode disables syntax highlighting, Markdown rendering, and automatic Git gutter markers. Explicit comparisons remain available using bounded plain-text diff computation. Files with more than 20,000 lines or a line longer than 20,000 characters also use simplified mode. Git diffs support up to 8 MB per version by default, with bounded streamed reads and an explicit warning if computation times out. The normal-mode, editing, viewing, and per-version diff limits can be configured for each environment in **Settings → Environments → Files and diffs**. Values range from 0.25 to 8 MB; normal ≤ editing ≤ viewing, and diff ≤ viewing. Preferences are stored in the current browser. The 8 MB ceiling protects the current whole-file transport. If edited content exceeds the configured editing limit, undo history is retained; reduce the content or raise the limit before saving.

Larger unsaved drafts use asynchronous IndexedDB recovery storage, written about 400 ms after typing stops, with a visible save status. Before leaving, confirm the draft has been saved in the browser or save it to disk. The UI reports unavailable browser storage; clearing site data removes local recovery copies.

## Quick start

Requires **Node.js 22.12+** and an installed, authenticated Codex CLI. Once the npm package has been published, run:

```sh
npx codex-workbench@latest
```

Open **http://127.0.0.1:5180** and connect to the default `ws://127.0.0.1:4501` under **Settings → Environment**. To choose another web port:

```sh
npx codex-workbench@latest --port 5181

# Or install the command globally
npm install -g codex-workbench
codex-workbench --port 5181
```

| Option              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `-p, --port <port>` | Web port; overrides `PORT`, defaults to 5180           |
| `--no-app-server`   | Start only the web service; manage app-server yourself |
| `-h, --help`        | Show help                                              |
| `-v, --version`     | Show the installed version                             |

The web service listens only on `127.0.0.1`. `--port` does not change the app-server port. Browser settings are separate for each web port. See the [user guide (中文)](docs/user-guide.md) for remote connections and data storage.

### Language

The interface follows your browser language by default: Chinese browsers use Simplified Chinese; other languages fall back to English. Under **Settings → General → Language**, choose **Browser default**, **English**, or **简体中文**. Changes take effect immediately and are saved in the current browser. The language setting does not translate user messages, model responses, or file contents.

## Develop from source

```sh
npm ci
npm run patch:release-tools
npm run dev
```

In development, start app-server in another terminal:

```sh
codex app-server --listen ws://127.0.0.1:4501
```

## Run a production build

A production build is intended for local use. Before release, follow the [release checklist (中文)](docs/release.md); see [Security (中文)](SECURITY.md) for trust boundaries and sensitive-data handling. Do not expose the workbench through a public tunnel or reverse proxy.

Stop any development service using the same port, then build and start:

```sh
npm ci
npm run patch:release-tools
npm run build
npm start
```

Build output goes to `dist/client/` and `dist/server/`. The production service runs compiled JavaScript and listens on **127.0.0.1:5180** by default. Use `npm start -- --port 5182` or `PORT=5182 npm start` to change the port. The web UI and `/bridge` share a port; `GET /healthz` reports web-service liveness.

For a standalone deployment directory, keep `dist/`, `package.json`, `package-lock.json`, and `.npmrc`, then run `npm ci --omit=dev` followed by `npm start`. Startup automatically runs `codex app-server --listen ws://127.0.0.1:4501`, or reuses an existing service on that port. If `codex` is missing or the child process fails to start, the web service remains available and reports the issue; you can connect to another app-server. The health endpoint only indicates web-service availability.

**Settings → Terminal output** shows the managed process's stdout, stderr, and startup messages (the most recent 128 KiB). Output is also forwarded to the terminal that launched `npm start`. Output from a reused external process is unavailable.

Listening addresses and Host/Origin checks are restricted to loopback; remote execution uses SSH forwarding. Stopping `npm start` stops the app-server it launched, but leaves pre-existing services running. `npm run dev` does not start or stop app-server.

## Run in the background on macOS

Use launchd to start the production build at login and restart it after unexpected exits. Build first, then install the service:

```sh
npm run build
npm run daemon:install
npm run daemon:status
```

Use `npm run daemon:start` to start, `daemon:stop` to stop, `daemon:restart` to regenerate configuration and restart, `daemon:logs` to follow logs (Ctrl+C to exit), and `daemon:uninstall` to stop and remove the service. Run `npm run daemon` for help.

The service ID is `com.codex-workbench`. Configuration is stored at `~/Library/LaunchAgents/com.codex-workbench.plist`; logs are written to `logs/start.out.log` and `logs/start.err.log` in the project. The service runs `dist/server/index.js` using the Node executable found at installation time, with the same startup behavior as `npm start`.

Installation and restart save the current PATH and PORT, for example `PORT=5182 npm run daemon:install`; no `.env` file is needed. After updating the code, run `npm run build && npm run daemon:restart`. Reinstall after moving the project or changing the Node installation path. Uninstalling retains logs.

## Validation

```sh
npm run check
npm run test:e2e
npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

`check` includes repository checks, type checking, linting, formatting, and unit/integration tests. Before the first browser test run, you may need `npx playwright install chromium`.

E2E tests use a separate web port (**5181**) and a protocol stub on a random port, without real Codex inference or SSH. They test development mode by default. Set `E2E_PRODUCTION=1` to test the compiled HTTP service and client, including production chunking checks. Production E2E uses a dedicated launcher that does not start, reuse, or read the user's real app-server. Run `npm run test:app-server` separately for a real app-server smoke test without inference.

The [user guide (中文)](docs/user-guide.md) covers connections, sessions, queues, and data storage. [Development and maintenance (中文)](docs/development.md) describes module responsibilities, protocol boundaries, and testing. The [API coverage inventory (中文)](docs/app-server-coverage.md) lists supported and deferred features.
