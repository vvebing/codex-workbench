# 运行与运维

本文面向本机安装、运行服务和连接远端环境。日常操作见[使用指南](user-guide.md)，开发与测试见[开发指南](development.md)。

## 运行条件

- Node.js 22.12 或更高版本。
- 可从启动进程的 PATH 调用的 Codex CLI；所选执行环境应已完成登录。
- 可访问的本机浏览器。工作台面向单用户使用，网页服务与 app-server 均应保持 loopback 监听。

## 命令行

```sh
npx codex-workbench@latest
```

也可安装常用命令：

```sh
npm install -g codex-workbench
codex-workbench --port 5181
```

| 参数                | 说明                                             |
| ------------------- | ------------------------------------------------ |
| `-p, --port <port>` | 网页端口；优先于 `PORT`，默认 5180，范围 1–65535 |
| `--no-app-server`   | 仅启动网页服务，自行管理 app-server              |
| `-h, --help`        | 查看帮助                                         |
| `-v, --version`     | 查看版本                                         |

网页默认地址为 `http://127.0.0.1:5180`，连接环境的默认地址为 `ws://127.0.0.1:4501`。修改网页端口不会改变 app-server 端口。浏览器设置按网页源保存，不同端口有独立的本地数据。

## 从源码运行发行构建

在项目根目录执行：

```sh
npm ci
npm run patch:release-tools
npm run build
npm start
```

`dist/client/` 为网页资源，`dist/server/` 为编译后的服务。修改端口：

```sh
npm start -- --port 5182
```

或：

```sh
PORT=5182 npm start
```

独立运行目录需包含 `dist/`、`package.json`、`package-lock.json` 和 `.npmrc`，在该目录执行 `npm ci --omit=dev` 后运行 `npm start`。Node.js 与 Codex CLI 仍需在目标机器上可用。

网页与 `/bridge` 共用网页端口。`GET /healthz` 仅报告网页服务存活，不代表 app-server 可连接、账户有效或任务可执行。

### app-server 生命周期与日志

启动时会检查 `127.0.0.1:4501`：已有监听则复用，否则执行：

```sh
codex app-server --listen ws://127.0.0.1:4501
```

退出工作台会停止它启动的子进程，保留原先已有的服务。找不到 `codex` 或子进程异常退出时，网页仍运行，可在设置中连接其他环境。

「设置 → 终端输出」显示托管进程最近 128 KiB 的 stdout、stderr 和启动信息，输出同时写入启动终端。复用外部服务时，需去该服务的启动终端查看日志。该面板是输出查看器；项目命令在「工作区」中运行。

开发模式 `npm run dev` 不启动或停止 app-server，需单独运行上述命令。

## 远端环境

在远端开发机启动：

```sh
codex app-server --listen ws://127.0.0.1:4500
```

在本机建立转发并保持终端运行：

```sh
ssh -N -L 14500:127.0.0.1:4500 dev-box
```

将 `dev-box` 替换为自己的 SSH 主机。在「设置 → 工作环境」添加 `ws://127.0.0.1:14500`，新会话填写远端机器上的工作目录。远端 Codex 账户、技能、文件和命令都属于该环境。

需要认证的服务可在连接表单填写 Bearer Token。它只保存在当前页面内存中，重新加载后需重新填写；它与 Codex 账户的 API Key 各自独立。

## macOS 后台服务

在项目根目录先构建，再安装用户级 launchd 服务：

```sh
npm run build
npm run daemon:install
npm run daemon:status
```

| 命令                       | 作用                     |
| -------------------------- | ------------------------ |
| `npm run daemon`           | 查看帮助                 |
| `npm run daemon:start`     | 启动                     |
| `npm run daemon:stop`      | 停止                     |
| `npm run daemon:restart`   | 重新生成配置并重启       |
| `npm run daemon:status`    | 查看状态                 |
| `npm run daemon:logs`      | 跟随日志，Ctrl+C 退出    |
| `npm run daemon:uninstall` | 停止并移除服务，保留日志 |

服务在用户登录后启动，异常退出后由 launchd 重启。标识为 `com.codex-workbench`，配置位于 `~/Library/LaunchAgents/com.codex-workbench.plist`，日志位于项目 `logs/start.out.log` 与 `logs/start.err.log`。

安装与重启会记录当前 PATH 和 PORT，例如 `PORT=5182 npm run daemon:install`。服务使用安装时发现的 Node 可执行文件运行 `dist/server/index.js`，无需 `.env`。

更新代码后先运行 `npm run build`，再运行 `npm run daemon:restart`。移动项目或更换 Node 路径后重新安装服务。

## 故障排查

| 现象                   | 检查与处理                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------ |
| 提示网页端口已占用     | 停止自己启动的旧进程，或通过 `--port` 指定其他端口；程序不会终止占用进程或自动换端口 |
| 提示缺少 UI 构建       | 在项目根目录运行 `npm run build`，确认 `dist/client/index.html` 存在                 |
| 网页正常但环境无法连接 | 核对 app-server 地址、进程日志、SSH 转发和连接认证；`/healthz` 不检测这些状态        |
| 提示找不到 `codex`     | 检查启动进程的 PATH；后台服务需在修正 PATH 后重新安装或重启                          |
| 环境断开后队列没有继续 | 连接后检查会话记录，再手动继续队列；投递结果未知时先核实，避免重复发送               |
| 本地偏好或草稿不见了   | 确认使用同一浏览器、网页地址与端口；清除站点数据会移除浏览器中的配置与恢复副本       |
| 文件保存或上传被拒绝   | 核对所选环境、目录、权限及文件大小；处理页面提示，避免覆盖外部修改                   |
| 某个工具面板不可用     | 阅读接口错误；确认账户、策略与服务提供的能力，重新连接或清除能力记录后重试           |

共享日志或问题附件前检查个人路径、代码与凭据。安全边界与披露方式见[安全说明](../SECURITY.md)。
