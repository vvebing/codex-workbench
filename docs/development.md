# 开发与维护

## 目录职责

| 路径                                                | 职责                                                 |
| --------------------------------------------------- | ---------------------------------------------------- |
| `server/`                                           | HTTP 静态服务、同源 WebSocket relay 与连接校验       |
| `src/features/connection/`                          | 环境配置、连接、模型与账户发现                       |
| `src/features/sessions/`                            | 会话操作、状态迁移、历史读取与轮询                   |
| `src/features/requests/`、`src/features/approvals/` | 服务端请求状态与审批界面                             |
| `src/features/composer/`                            | 编辑器、内存草稿、发送流程和持久化待发送队列         |
| `src/features/conversation/`                        | 时间线、操作详情、Markdown、子代理观察与导出         |
| `src/features/navigation/`、`settings/`、`shell/`   | 导航、会话链接、偏好与应用组合                       |
| `src/components/`                                   | 公共 UI 控件与界面 hooks                             |
| `src/lib/`                                          | RPC、共享状态归并、runtime 组合与页面离开处理        |
| `src/generated/`                                    | 生成的 app-server 协议类型，禁止手工修改             |
| `public/`                                           | 随客户端构建交付的产品图标等静态资产                 |
| `scripts/`                                          | 构建清理等维护脚本                                   |
| `tests/unit/`                                       | Vitest 状态、模型与功能单元测试                      |
| `tests/integration/`                                | Node test runner 的 bridge 与真实 WebSocket 协议测试 |
| `tests/e2e/`                                        | Playwright 浏览器交互测试                            |
| `tests/smoke/`                                      | 连接真实 Codex app-server 的非推理烟测               |
| `tests/fixtures/`                                   | 测试专用 app-server 协议替身                         |
| `.github/workflows/`                                | 持续集成检查与浏览器测试                             |
| `docs/`                                             | 使用说明与维护约定                                   |
| `dist/`、`test-results/`                            | 构建和验证产物，不纳入源码                           |

功能代码按业务职责放在对应 feature；只被一个功能使用的模型、样式和工具与该功能放在一起。跨功能基础能力才放入 `lib/` 或 `components/`。生成类型和测试替身分别保留在独立目录，不进入产品界面流程。

`src/features/files/` 管理文件工作区、编辑器与文件链接；`src/features/shell/` 中的 Git 模块管理工作区 Git 状态和操作。不要在上线收尾阶段仅为目录美观迁移这些功能或手改生成协议。维护脚本使用 ESM（`.mjs`），与应用代码一起接受 ESLint 检查。

## 运行与构建

```sh
npm ci
npm run dev
```

开发服务在 `127.0.0.1:5180` 提供页面并挂载 `/bridge`，通过 `npm run dev -- --port 5182` 可修改端口。`strictPort` 保证端口冲突时直接失败。

`npm run build` 执行类型检查、清理旧构建、客户端打包和服务端编译，分别写入 `dist/client/`、`dist/server/`。`npm start` 运行编译后的服务端，生产依赖不需要 TypeScript 或 tsx；生产交付方法见 [README](../README.md)。`.npmrc` 与锁文件一同保留，以维持当前依赖树的安装方式。

`server/http.ts` 负责静态文件与 `/healthz`，`server/bridge.ts` 负责 WebSocket relay，`server/request-policy.ts` 集中入口校验，`server/security-headers.ts` 统一开发与生产响应头。生产静态目录由模块路径定位。`npm run clean` 只删除 `dist/`。

生产 `/healthz` 只检查网页服务存活。网页服务、app-server 和 SSH 转发是独立进程；开发服务关闭或重启只关闭网页和 relay，不管理用户终端中的进程。

## 协议与状态边界

浏览器连接同源 `/bridge`，首帧发送连接地址与可选 Token；bridge 转发上游帧，保留请求 ID、通知、审批响应和内容。浏览器入口校验 loopback Host／HTTP Origin；上游支持 `ws://`、`wss://`，拒绝 URL 内嵌凭据、片段和跳转。Token 仅转发为上游 Authorization header。relay 具有握手超时、心跳和缓冲区限制，断线不重放变更请求。

每个环境由 `createRuntime()` 组合独立的 connection、sessions、requests、drafts、submissions 和 queue。连接 epoch 和选择 generation 防止旧请求影响新连接或新选择；异步结果归并前应检查它们是否仍有效。

查看历史使用 `thread/read` 和分页读取，不获取 writer。发送时由会话层通过 `thread/resume` 确认写入能力；`threadAccess` 是唯一的写入能力来源，服务端 `active` 只描述执行状态。断线、线程关闭或服务端拒绝写入会撤销该能力。

新建入口只保存本地草稿，首次发送依次执行 `thread/start`、`turn/start`，确认后才迁移到正式 ID。发送快照和草稿 revision 保护异步提交期间的新输入；发送状态位于环境级 store，切换会话不会产生重复提交。明确的立即引导使用 `turn/steer`，停止使用 `turn/interrupt`。

待发送队列保存完整输入与配置快照，按环境、地址和会话隔离。IndexedDB 存储任务，Web Locks 串行化多标签页写入和发送，BroadcastChannel 同步变化。恢复和重连先暂停；结果不确定的变更请求必须由用户核实后处理。

历史与实时事件在 `lib/state.ts` 中归并，读取旧快照不能回退较新的内容或完成状态。优先使用有效事件流，未订阅会话通过 `sessions/polling.ts` 串行轮询；断线停止，重连恢复，后台环境与隐藏页面降低频率。

子代理列表和抽屉共用只读观察器；无人订阅时释放监听与计时器，完成后停止补读。临时线程精确匹配服务端的历史不可用错误时回退到元数据，其他读取错误继续报告。只读历史读取不代表服务端事件订阅。

页面和系统通知按 app-server 的 `parentThreadId`、来源和显式子代理活动统一过滤。未知线程先用 `thread/read` 补读身份，未确认前不发送通知；问题与审批请求仍保留在原请求 store 中，由子代理抽屉处理。`optOutNotificationMethods` 按事件方法对整个连接生效，不能用于只屏蔽子代理，也不会屏蔽服务端请求。

右上角分支与文件改动数通过现有 `command/exec` 在所选环境执行只读 `git status`，不创建会话或轮次。`gitInfo` 是会话存储的分支快照，未提供工作区改动计数；因此直接复用原生 Git 的 porcelain v2 NUL 输出，重命名只计一次，解析后不保存文件路径。页面可见时约每十秒同步，并在 diff、轮次完成和恢复可见时刷新；切换连接、会话或目录丢弃旧结果。原生调用方式见 [OpenAI 官方 app-server 文档](https://learn.chatgpt.com/docs/app-server#command-execution)。

保留完整的 `src/generated/` 协议快照，不按当前引用情况裁剪，也不手工修改。升级 Codex CLI 或更新协议时，应重新运行类型检查和相关测试，并核对初始化、分页历史、writer 冲突、审批选项和临时线程行为。项目中的类型描述协议，不保证所有服务端版本都提供同样能力。

更新类型时先将当前 CLI 的完整协议生成到临时目录，审阅差异后再替换 `src/generated/`：

```sh
codex app-server generate-ts --out /tmp/codex-workbench-protocol --experimental
```

示例通过 `--experimental` 保留完整类型快照；客户端初始化使用 `experimentalApi: true`，使应用发现等已接入接口可以通过能力检查；这项声明不修改服务端实验功能开关。生成类型本身不会启用运行时能力。记录执行时的 `codex --version`，并在替换后执行 `npm run check`。

## 界面与样式

布局、间距和交互状态优先使用 Tailwind utility；重复控件复用 `src/components/ui.tsx` 中的 Button、IconButton、Modal、Menu 和 SelectField。入口 `src/main.tsx` 必须先导入 `src/styles.css`，再导入 App 和功能模块，确保生产打包时先声明 Tailwind 层顺序，避免基础重置覆盖组件样式。输入框内边距使用 `px-4 pt-4 pb-2`，窄屏用 `px-3 pt-3`，遵循四像素间距单位。设计变量集中在 `src/theme.css`，`src/styles.css` 负责导入、基础样式和移动端视口保护。主题使用 `bg-surface`、`text-muted`、`border-border` 等语义 token；局部 CSS 读取同一组变量，不再单独定义颜色或固定字号。

字号使用已有的 `text-xs/sm/base/lg` 或命名角色：`text-fine`（10px 提示）、`text-meta`（11px 元信息）、`text-caption`（12px 辅助说明）、`text-control`（13px 控件）、`text-body`（14px 正文）、`text-prose`（15px Markdown）、`text-code`（13px 代码）。品牌和标题保留独立角色，避免重构改变现有层级。命名角色默认继承行高；标准字号保留 Tailwind 原有行高。正文、代码等特殊行高使用 `leading-copy/prose/code`。不要新增 `text-[13px]` 等重复定义；确有新层级时先扩展 token。

在根元素设置 `--font-scale: 1.125` 可统一放大文字；`--code-font-size` 独立控制 Monaco 和 Markdown 代码块字号（默认 13px），`--font-sans`、`--font-mono` 分别控制界面与等宽字体。界面默认倍率为 1；`--root-font-size` 固定 rem 布局基准，`--spacing` 独立控制间距。移动端输入框通过 `--mobile-input-size` 保持至少 16px，避免聚焦自动缩放。设置弹窗的“通用 → 字体与字号”提供界面基准字号、代码字号、界面字体、等宽字体、即时预览和重置入口。字号选项以 px 展示和保存，界面基准默认为 14px，标题和辅助文字按比例调整；代码默认为 13px，不受界面字号影响。旧百分比偏好自动换算为等效 px，保留小数值以避免改变原有显示大小。偏好以 `codex-workbench.typography` 保存到当前浏览器，在 React 挂载前恢复，并同步其他标签页；存储不可用时仍可在本次访问中调整。重置仅清除字体覆盖，保留主题与视口变量。字体预设集中在主题文件，未安装的字体使用备用字体，不下载外部字体。

Monaco 和 Mermaid 通过 `src/lib/appearance.ts` 读取同一组变量；字号经过浏览器计算后传入渲染器，不能直接对含 `calc()` 的 CSS 变量使用 `parseFloat`。根元素的主题、class 或内联变量改变后，编辑器更新外观，图表重新渲染。供这两个渲染器使用的主题颜色采用十六进制值；编辑器继承原生语言主题并覆盖应用表面色及常见语法色。遮罩、差异颜色和文件弹窗阴影也在主题文件维护。

设置弹窗由 `SettingsDialog.tsx` 组合分类导航和独立滚动内容，包含通用、工作环境、已归档会话与终端输出四个分类；通用包含显示与执行中发送偏好；工作环境先选择设备，再切换连接与账户、模型与权限、工具与集成、配置迁移。浏览器模型偏好与服务端模型配置放在同一页，分别标明作用范围。表单状态保留在弹窗的职责 hook 中，连接表单和浏览器模型偏好在切换分类时保留普通未保存字段，设备工具表单随页面或设备切换重置；Token 在关闭、切换分类、子页面或环境时清空。环境选择器仅用于工作环境与归档，浏览器模型偏好是当前浏览器的全局偏好；跟随设备默认的新草稿首发不指定模型和非显式推理强度，由服务端解析有效配置。设置内使用四像素间距单位，控件、卡片和弹窗圆角分别为 8、12、16 像素；圆角变量限定在设置弹窗，避免受根字体大小影响。

命令汇总的手动展开／折叠选择保存在现有 `OperationGroup`，按汇总成员和会话／轮次身份关联；命令追加和历史压缩保留用户选择；操作结束统一收起，之后可手动重开。最终总结保持可见。

菜单、编辑器和 Markdown 等复杂或第三方节点排版使用作用域明确的局部 CSS，保持 `@layer components` 和低优先级选择器。样式类只负责展示，测试定位使用可访问名称或 `data-slot`。Radix 负责弹窗和菜单焦点，面板库负责尺寸调整。

是否保留局部 CSS 取决于第三方 DOM、结构选择器和组件内部关联状态，不以类名长度作为唯一依据。简单布局直接写 utility，重复控件优先抽组件/变体，不批量使用 `@apply` 隐藏重复。utility 层优先于 components 层，给通用控件设置选中状态时应使用 `aria-pressed:*` 等变体。动态宽度、树缩进与图表缩放可保留内联数值。`styles.css` 中视口安全区和移动输入框保护有意不分层，以覆盖工具类和第三方样式。

编辑器使用 Tiptap／ProseMirror 的文本、段落、换行、原子引用节点与历史能力。草稿同时保存结构化文档和协议所需文本／技能信息，删除、粘贴、撤销引用时应保持两者一致。

Mermaid 按需加载并串行渲染，以隔离其共享配置；保持严格安全模式、移除图表导航链接，渲染失败时保留源码。`public/icons/` 和 `public/favicon.ico` 是产品资产，运行态 favicon 汇总所有已连接环境的已加载执行状态。

Monaco 的可见差异编辑器和离屏 Git 行标记共用 `src/features/files/diff-model.ts` 管理 diff ViewModel。切换、关闭或卸载时先解绑并释放 ViewModel，以取消异步计算，再释放编辑器和文本模型；不要仅依赖隐式模型清理。单元测试验证取消顺序，浏览器生命周期回归验证真实 worker 在文件切换、进出 diff 和关闭重开后仍能诊断、编辑和保存，且无页面异常。

## 验证

```sh
npm run check
npm run test:e2e
npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

`check` 包含提交内容检查、类型检查、lint、格式检查和 `npm test`；类型检查覆盖产品代码、配置和测试。可用 `npm run test:unit`、`npm run test:integration` 单独运行对应测试。

`npm run check:repository` 检查 Git 暂存区和未忽略的工作区文件，阻止常见凭据、私钥、私人配置、生成产物、未批准的图片／PDF、含 NUL 的二进制文件和未审查的符号链接／子模块进入仓库，报错只显示文件路径和类别。当前白名单是 `public/` 中的六张 PNG 产品图标和一个 ICO；新增产品图片需要先检查内容与元数据，再更新脚本白名单和 `.gitignore`。常见位图、PDF、`.env`、本地认证配置、截图、报告与图像生成输出均已加入忽略规则；SVG 不静默忽略，但提交检查会拒绝。`.env.example` 只允许占位值，仍接受凭据扫描。

该检查不是完整的秘密扫描器：不遍历 Git 历史、不读取忽略文件、不解包归档，也不能识别所有凭据格式或图片中的敏感信息。修改工作区不会清除暂存区旧内容；暂存最终版本后应再次检查。详见[安全说明](../SECURITY.md)和[发布流程](release.md)。

首次运行 E2E 可执行 `npx playwright install chromium`。测试网页使用 `127.0.0.1:5181`，每项用例的协议替身监听随机端口并在结束后关闭。单元、协议和浏览器测试不连接用户 app-server，不执行真实推理或 SSH。仅在失败时生成浏览器截图与追踪，和烟测结果一起写入 `test-results/`，不写入文档目录，也不在 CI 中上传。trace 可能包含本机路径，排查结束后删除该目录。

本机已安装 Codex CLI 时可单独执行：

```sh
npm run test:app-server
```

该脚本启动独立的 stdio app-server，用生产 RPC、历史读取层和子代理观察器创建一个只读临时测试线程，验证初始化与临时会话的元数据读取；不执行模型推理，不恢复已有线程。结果记录 CLI 版本和检查项，不保存会话内容或凭据。

CI 使用 Node.js 22 安装锁定依赖，执行 `npm audit --audit-level=low`、`check`、生产构建和生产模式 Playwright。`E2E_PRODUCTION=1` 使用 `tests/fixtures/production-server.mjs` 加载 `dist/server/http.js` 与 `dist/client/`，而不是运行会管理本机进程的 `npm start`；它不启动或探测真实 app-server。生产模式启用分包加载测试，并验收终端输出界面；开发模式保留手动启动提示的回归。真实 app-server 烟测需要本机 Codex CLI，单独运行。

`package.json` 暂时将 Monaco 的传递依赖 DOMPurify 覆盖为 `3.4.17`，避免其固定依赖 `3.4.15` 引入已知安全公告 GHSA-p98j-92pf-mc4p 和 GHSA-6688-9rhm-gjv2。升级 Monaco 时复核上游依赖；上游包含修复后移除覆盖，并重新运行依赖审计、编辑器与 Markdown／Mermaid 测试。不要为消除审计提示强制降级编辑器。

自动化协议替身和非推理烟测不覆盖真实模型推理、命令执行、文件修改、远端认证和 SSH 稳定性。这些行为需要在实际使用的 app-server 环境中验证；发布记录应描述当次真实结果，不复用旧验收计数。

会话布局默认为自适应宽度；“通用 → 会话布局”可切换到 840px 阅读宽度。`--conversation-max-width` 与 `.conversation-content` 统一正文、输入区和问答面板的宽度及标准间距。布局偏好单独保存在 `codex-workbench.conversation-width`，支持跨标签页同步。输入区使用命名容器 `conversation` 的断点；编辑器并排依据可用工作区宽度，不依赖浏览器窗口宽度。

连接初始化时从 `initialize.userAgent` 的首个 `codex_web/<version>` 标识提取运行中 app-server 的版本，不使用末尾客户端版本；无法识别则显示未知。版本按连接隔离，断开即清除。“工作环境 → 连接信息”提供手动检查更新，通过同源 `GET /codex-release` 查询 OpenAI Codex 官方 GitHub 最新稳定发布。开发与生产服务共用实现，成功缓存 5 分钟、失败冷却 30 秒、请求超时 8 秒，并合并并发查询。只提示稳定版本更新和发布说明，不执行更新或重启；预发布版本不会被建议降级。

左右侧栏采用 px 偏好：导航默认 280px（240～400px）、项目面板默认 320px（280～480px）。`ShellPanels` 将像素转换为面板库比例，但只在用户拖拽结束或键盘调整后保存 `codex-workbench.sidebar-widths`；窗口缩放、隐藏面板和临时收缩均不改写偏好。中间工作区至少保留 480px，空间不足时项目面板改为抽屉。设置中的“重置侧栏宽度”恢复默认值，也可双击分隔条重置对应侧栏；旧版百分比存储不再用于新布局。

会话 Markdown 中的 PNG/JPEG/GIF/WebP 文件链接点击后通过当前 app-server 的 `fs/readFile` 读取，验证图片格式与大小后复用缩放预览弹窗。意外生成的同源 HTTP 图片链接仅在原会话 cwd 内回收为工作区文件链接，拒绝路径穿越；读取结果按连接与文件路径隔离。该功能不将工作区目录开放为静态 HTTP 资源，直接访问裸 `/data/...` URL 仍可能返回 404。

每次环境连接成功会触发后台版本检查，共用浏览器内 5 分钟缓存并合并并发请求；失败冷却 30 秒，设置中的手动检查可立即重试。主界面仅在当前环境版本可识别且存在更高稳定版本时显示可关闭的更新提示，重连后可再次提示；无更新或检查失败时保持安静。若仍在运行的旧网页后端对 `/codex-release` 返回 HTML/404，浏览器兼容性回退直接请求官方公开 GitHub 发布 API（不携带凭据），无需为此中断 app-server。新后端仍优先使用同源更新接口。

文件工作区中的 PNG/JPEG/GIF/WebP 在原文件标签页中自适应预览，不进入 Monaco 文本模型。图片通过 app-server 读取并复用格式和编码大小（10 MB）校验；只读预览不提供文本保存/比较操作，读取或解码失败显示错误。切换图片与文本标签保留代码模型和撤销历史。

`ImageViewer` 统一负责预览图片的渲染、等比适应与加载失败提示，图片源变化时重置失败状态。`ImagePreview` 提供弹窗和焦点恢复，`FileImagePreview` 提供文件标签页布局，两者复用同一查看组件；会话缩略图保留独立的尺寸与交互。

## app-server 接口审计

RPC 请求参数通过 `ClientRequest` 派生的 `RpcCall` 绑定方法与参数，业务层不能直接再次初始化连接。不要添加 `string/unknown` 透传或绕过契约的类型断言。返回类型目前仍需调用方引用生成类型；完整响应映射尚待补齐。

修改调用或通知处理后，运行 `npm run audit:protocol` 更新 [逐项清单](app-server-interface-matrix.md)。`npm run check:protocol` 会验证生成结果，已纳入 `npm run check`。类型负例在 `tests/types/rpc-contract.ts`；审计结论与版本限制见 [审计报告](app-server-audit-2026-10-20.md)。
