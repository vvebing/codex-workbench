# GitHub Pages 交互演示

演示直接复用 `src/main.tsx`、工作台 App、导航、会话时间线、输入框、设置和 Monaco 文件编辑器。旧的 `pages/` 独立 HTML/CSS/JavaScript 页面已删除，不再维护第二套 UI。

## 实现方式

- `vite.demo.config.ts` 使用独立入口 `src/demo/main.ts`，随后加载正常的 `src/main.tsx`。`--mode demo` 在构建时启用演示模式。
- `src/lib/runtime.ts` 仅在演示模式下注入 `createDemoSocket`，沿用现有 `CodexClient`、JSON-RPC 协议、状态仓库与组件。正常开发和发行构建继续使用真实 WebSocket bridge。
- `src/demo/data.ts` 提供虚构项目、会话和文件；`src/demo/transport.ts` 在浏览器内处理协议请求与通知，不启动 Node 服务，不调用模型，不读取本机文件。
- 顶部演示提示使用现有主题和 Button 组件。重置演示或刷新页面会重新创建模拟服务，恢复示例会话与文件。外观偏好及工作台已有的浏览器草稿恢复机制仍会保存到浏览器，不是发送给真实后端。

可以体验项目与会话导航、搜索、创建/重命名/分叉/归档会话、发送预设回复、停止演示回复、文件浏览、编辑与内存保存、模拟 Git 状态和 Monaco 代码差异、只读终端，以及现有主题、语言和面板设置。所有显示的任务结果都属于虚构数据。

模拟服务只实现明确支持的协议方法。真实登录、外部环境连接、任意终端命令、Git 写操作和未实现的集成返回演示说明，不会伪造成功结果。本机服务输出和更新检查在演示模式下关闭。文件改动仅保存在本页模拟服务中，不会写入仓库。

## 只读终端演示

选中演示项目后点击顶部终端图标即可输入命令。启动输出明确标注为浏览器内模拟；提示符显示当前目录，执行 `cd` 后同步更新。输入 `help` 可查看支持范围。示例包括：

```sh
pwd
ls
cd src
cat ProjectList.tsx
cd ..
find . -name '*.md'
cat README.md | head -n 3
rg -n projects src
cat 'docs/示例 说明.md'
tail -f logs/app.log
```

日志跟踪读取虚拟文件，按 `Ctrl+C` 停止；在编辑器中修改该演示日志时，跟踪输出随之更新。可以体验多标签、调整尺寸、收起后展开、运行中关闭确认，以及只读写入拒绝。手机仍仅查看输出。

模拟终端会为当前路径、目录、搜索命中、Git 差异和错误提示显示 ANSI 颜色，随工作台浅色／深色主题变化；简单管道仍传递原始文本，颜色不会改变统计结果。这里展示的是提示符及输出着色，不包含输入命令的实时语法高亮。

演示只模拟有限的命令、参数和简单管道，不解析或运行真实 shell 程序，也不访问本机文件或外部网络。未实现的命令和复杂语法会明确提示不支持；终端写入、安装依赖及网络命令会被拒绝。正式终端通过执行环境的真实只读 shell 运行，两者能力边界不同。刷新或重置演示会清除模拟终端进程和恢复示例文件，不会自动重放命令。

## 本地开发与构建

需要与主项目相同的 Node.js 版本和依赖：

```sh
npm ci
npm run dev:demo
```

打开 http://127.0.0.1:5182/ 。独立演示开发配置不加载本机 bridge 插件。

构建与预览：

```sh
npm run build:demo
npm run preview:demo
```

静态输出在 `dist/demo/`，不包含 Node 服务或工作区数据。`base: "./"` 使脚本、样式、图标、动态分包及 Monaco worker 使用相对资源地址，支持用户站点、仓库子路径和自定义域名。会话路由使用查询参数，无需服务器 SPA 路由回退。

## 验证

```sh
npx vitest run tests/unit/demo-transport.test.ts
npm run test:demo
```

协议测试通过真实 CodexClient 和 Git 差异读取逻辑验证模拟服务，覆盖历史、搜索、UTF-8 文件、监听、流式 Git 内容、回复完成/停止、服务数据隔离与真实连接拒绝。

独立 Playwright 配置将构建产物挂在 `/codex-workbench/` 路径，缺失资源返回真实 404，检查首屏、会话切换、查询路由刷新、模拟消息与重置，以及手机布局。测试拒绝非静态资源请求并检测意外 WebSocket 连接。

## 发布

1. 在仓库 Settings → Pages → Build and deployment 中选择 **GitHub Actions**。
2. 合并到 `main` 后，相关源文件变更会触发 `Deploy interactive demo to GitHub Pages`，也可在 Actions 中手动运行。
3. 工作流安装依赖、执行类型检查与演示测试、构建真实 UI，再通过 GitHub 官方 Pages actions 上传和部署 `dist/demo`。
4. 成功后访问部署环境输出的地址。本仓库默认地址为 https://vvebing.github.io/codex-workbench/ 。

工作流产物根目录包含 `index.html`，部署使用 `github-pages` 环境与 `pages: write`、`id-token: write` 权限。不要将仓库根目录或整个 `dist/` 作为 Pages 产物。Actions 直接上传静态产物，不经过 Jekyll，因此不依赖 `.nojekyll` 文件。

参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。首次启用 Pages 需要仓库管理权限；提交代码本身不会更改仓库设置或立即发布站点。
