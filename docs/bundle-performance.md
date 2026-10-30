# 构建与加载

运行 `npm run build` 后，用 `node scripts/bundle-report.mjs` 查看首屏静态依赖和全部 JS/CSS 的大小。报告依据 Vite manifest 递归计算静态 import，包含 CSS，不把动态 import 当作首屏资源。gzip 为估算值；当前 Node HTTP 服务不启用压缩。

资源大小随依赖和代码变化。以当前构建报告为准，记录首屏静态依赖与全部资源两种口径。包大小不等于首屏耗时，gzip 估算也不表示服务已发送压缩响应。

## 按需加载

- 首页保留导航、连接、会话状态等基础代码。
- Composer、Timeline 在打开会话时加载；设置、搜索、项目面板、子代理面板在打开时加载。
- 草稿 JSON 处理不依赖 Tiptap 运行时代码，引用节点扩展随 Composer 加载。
- Monaco 在桌面打开文件时加载，移动端仍使用只读文本；语言定义及 JSON 服务沿用现有按需加载。
- Mermaid 在首次渲染图表时加载，保留全部现有图表类型。
- 可选功能有加载提示和错误边界。静态资源加载失败不会自动刷新并丢失当前草稿。

这主要减少首页下载和解析成本，不等于减少所有功能合计的 dist 体积。直接打开历史会话仍需额外下载 Composer、Timeline；不能将首页体积变化当作所有入口的加载时间提升。

## Monaco 部署选择

当前采用本地 ESM 构建，Monaco、语言模块、CSS、字体和 worker 都是 `dist/client/assets` 下的静态文件。它们存在于 dist 中，不代表打开首页就会下载。保留此方案可使用本地环境，无需额外的外网连接，并由同一次构建保证编辑器和 worker 版本一致。

Monaco 不一定必须放在应用 dist 中，也可以单独构建和部署到自己的静态服务或 CDN。但这需要一起管理模块入口、语言模块、CSS/字体、worker URL、跨域策略和版本；只是转移部署位置，不会自动减少总下载量。只把 `monaco-editor` 标记为 external 或复制 npm 包并不能完成浏览器集成。

如果未来需要多个应用共享 Monaco，可单独发布版本化的 ESM 资源包。当前项目优先保留自包含构建，不默认依赖第三方 CDN，也不通过删除语言或图表类型来缩减功能。

## 缓存与验证

生产服务对 `/assets/` 下带内容哈希的文件设置一年 immutable 缓存；HTML 和其他资源保留 no-cache，避免入口引用过期版本。替换构建后，已打开页面可能仍请求先前的懒加载资源；资源加载失败由错误边界展示恢复入口。

```sh
npm run check
npm run build
node scripts/bundle-report.mjs
E2E_PRODUCTION=1 npm run test:e2e
```

`E2E_PRODUCTION=1` 使用实际 dist 和生产 HTTP 服务；默认 E2E 仍使用 Vite 开发服务。`tests/e2e/loading.spec.ts` 检查首页不请求可选功能 chunk、打开设置与搜索后才请求对应代码。文件工作区测试覆盖 Monaco 编辑和 JSON worker。

参考：[Vite 动态加载](https://vite.dev/guide/features.html)、[Monaco 官方仓库](https://github.com/microsoft/monaco-editor)。
