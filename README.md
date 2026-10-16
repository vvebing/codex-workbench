# Codex 工作台

中文 Codex Web 客户端，用于连接本机或通过 SSH 转发的 Codex app-server，管理会话、消息队列、审批与子代理活动。前端使用 React、TypeScript 和 Vite，网页服务提供同源 WebSocket bridge。

## 快速开始

需要 Node.js **22.12+**、npm，以及已安装并完成登录的 Codex CLI。

在项目根目录安装依赖并启动工作台：

```sh
npm ci
npm run dev
```

在另一个终端启动 Codex app-server：

```sh
codex app-server --listen ws://127.0.0.1:4501
```

打开 **http://127.0.0.1:5180**，在「设置 → 工作环境」确认地址为 `ws://127.0.0.1:4501` 并连接。app-server 的启动、停止和终端日志由该终端管理。

工作台支持多个环境同时连接。远端连接通过 SSH 将 app-server 端口转发到本机；工作目录使用实际执行任务的环境路径。具体配置见[使用指南](docs/user-guide.md)。

## 生产运行

这里的“生产运行”指本机发行构建，不是公网或多人服务。发布前请完成[发布检查清单](docs/release.md)，安全边界与敏感数据处理见[安全说明](SECURITY.md)。不要通过反向代理或公网隧道暴露工作台。

先停止占用相同端口的开发服务，再构建和启动：

```sh
npm ci
npm run build
npm start
```

构建产物位于 `dist/client/` 和 `dist/server/`。生产服务运行编译后的 JavaScript，默认监听 **127.0.0.1:5180**；使用 `PORT=5182 npm start` 修改端口。网页和 `/bridge` 共用一个端口，`GET /healthz` 返回网页服务的存活状态。

向独立运行目录交付时，保留 `dist/`、`package.json`、`package-lock.json` 和 `.npmrc`，执行 `npm ci --omit=dev` 后即可 `npm start`。`npm start` 会自动执行 `codex app-server --listen ws://127.0.0.1:4501`；若该端口已有服务则直接复用。找不到 `codex` 或子进程启动失败时会输出提示，网页服务继续运行，可连接其他 app-server。健康检查仅代表网页服务可用。在「设置 → 终端输出」可查看该进程的 stdout、stderr 和启动提示（最近 128 KiB）；输出仍会同步到启动 `npm start` 的终端。复用外部进程时无法读取其输出。

当前服务面向本机使用，监听和 Host／Origin 校验均限制为 loopback；远端执行通过 SSH 转发连接。停止 `npm start` 会关闭它启动的 app-server，不会停止用户原先运行的服务。`npm run dev` 不会启动或停止 app-server，开发时仍需手动运行。

## 开发与验证

```sh
npm run check
npm run test:e2e
npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

`check` 包含提交内容检查、类型检查、lint、格式检查和单元／集成测试。首次运行浏览器测试可先执行 `npx playwright install chromium`。E2E 使用独立网页端口 **5181** 和随机端口的协议替身，不执行真实 Codex 推理或 SSH。默认验证开发模式；设置 `E2E_PRODUCTION=1` 后验证编译后的 HTTP 服务与客户端，并启用生产分包检查。生产 E2E 使用专用启动器，不启动、复用或读取用户的真实 app-server。真实 app-server 的非推理烟测可通过 `npm run test:app-server` 单独运行。

[使用指南](docs/user-guide.md)介绍连接、会话、队列与数据保存；[开发与维护](docs/development.md)说明目录职责、协议边界和测试方式；[接口覆盖清单](docs/app-server-coverage.md)列出已接入功能和暂缓范围。
