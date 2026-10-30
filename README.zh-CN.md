<p align="center">
  <img src="https://raw.githubusercontent.com/vvebing/codex-workbench/main/public/icons/product-icon.png" width="112" height="112" alt="Codex 工作台图标" />
</p>

# Codex 工作台

[English](README.md) · 简体中文

一个本机优先、支持中英文的 Codex 网页工作区，集中管理会话、消息队列、审批和子代理协作。

按项目组织对话，同时连接本机与远端环境，在对话旁编辑文件和审阅代码。任务通过所选环境的 Codex app-server 执行。

![Codex 工作台中的项目、对话与编辑器](docs/images/workbench-overview.png)

截图使用虚构项目与会话。界面支持 English 和简体中文。

## 快速开始

需要 **Node.js 22.12+**，以及已安装、完成登录且可从 PATH 调用的 **Codex CLI**。

```sh
npx codex-workbench@latest
```

打开 **http://127.0.0.1:5180**，在「设置 → 工作环境」连接 `ws://127.0.0.1:4501`，选择项目目录后发送第一条消息。发行服务会启动本机 app-server，或复用端口 4501 上已有的服务。

也可以从源码运行：

```sh
git clone https://github.com/vvebing/codex-workbench.git
cd codex-workbench
npm ci
npm run patch:release-tools
npm run build
npm start
```

网页服务监听 `127.0.0.1`，面向本机单用户使用。远端执行环境通过 SSH 转发连接；不要通过公网隧道或反向代理公开工作台。详见[运行与运维](docs/operations.md)和[安全说明](SECURITY.md)。

## 功能

| 场景     | 能力                                                           |
| -------- | -------------------------------------------------------------- |
| 工作环境 | 连接本机与 SSH 转发的开发机，按环境、项目和分区组织工作        |
| 会话     | 搜索历史、收藏、分叉、归档与导出                               |
| 执行     | 排队消息、引导当前任务、处理审批和问题、跟进子代理             |
| 上下文   | 引用文件和技能、添加图片与文档附件、设置目标、发起代码审查     |
| 文件     | 浏览、搜索、上传、下载与编辑项目文件，预览 Markdown 和 Mermaid |
| 代码审阅 | 查看已暂存、未暂存和未跟踪文件的差异，导出补丁与查看工作树     |
| 偏好     | 切换中英文、明暗主题、模型设置与面板尺寸                       |

<details>
<summary>代码审阅</summary>

![左右对照代码差异与 Git 状态](docs/images/code-review.png)

</details>

<details>
<summary>审批与子代理</summary>

![核对命令后决定是否审批](docs/images/approvals.png)

![在主会话旁跟进子代理输出](docs/images/subagent-collaboration.png)

</details>

<details>
<summary>待办中心</summary>

![按环境汇总待处理请求](docs/images/task-center.png)

</details>

## 文档

- [文档导航](docs/README.md)：按使用场景查找指南与技术参考。
- [使用指南](docs/user-guide.md)：环境、会话、队列、文件与数据保存。
- [运行与运维](docs/operations.md)：命令行参数、发行构建、SSH、macOS 后台服务与排障。
- [开发指南](docs/development.md)：架构、本地开发与验证。
- [参与开发](CONTRIBUTING.md)、[发布流程](docs/release.md)和[安全说明](SECURITY.md)。
- [产品范围](PRODUCT.md)、[设计系统](DESIGN.md)和[app-server 接口覆盖](docs/app-server-coverage.md)。

## 开发

```sh
npm ci
npm run patch:release-tools
npm run dev
```

另开终端启动：

```sh
codex app-server --listen ws://127.0.0.1:4501
```

开发模式不管理 app-server。验证命令：

```sh
npm run check
npm run test:e2e
npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

首次运行浏览器测试前执行 `npx playwright install chromium`。E2E 使用隔离的协议替身；真实 app-server 的非推理烟测单独运行 `npm run test:app-server`。测试范围和前提见[开发指南](docs/development.md)。

## 许可证

[MIT](LICENSE)
