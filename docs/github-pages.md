# GitHub Pages 交互演示

`pages/` 是独立的静态工作台演示，展示虚构项目、会话、文件差异和任务记录。支持会话搜索、文件切换、演示消息、主题切换和重置。消息仅保存在当前页面内存中，不会调用模型、本机服务或 WebSocket。刷新页面恢复初始数据。

## 发布

1. 在仓库 Settings → Pages → Build and deployment 中选择 **GitHub Actions**。
2. 合并到 `main` 后，修改演示文件会触发 `Deploy interactive demo to GitHub Pages`；也可在 Actions 页面手动运行。
3. 成功后访问部署环境输出的地址。本仓库默认地址为 https://vvebing.github.io/codex-workbench/ 。

工作流使用 GitHub 官方 Pages actions，上传产物的根目录包含 `index.html`，通过 `github-pages` 环境部署，仅部署任务授予 `pages: write` 和 `id-token: write`。静态资源使用相对路径，兼容仓库子路径与自定义域名，不使用服务端路由。`.nojekyll` 明确标记静态内容。

产物只包含演示 HTML、CSS、JavaScript 与两个公开产品图标，不包含本机工作台、服务端代码、配置或实际会话数据。不要将整个仓库作为 Pages 产物上传。

## 本地预览

在仓库根目录执行：

```sh
mkdir -p dist/pages/icons
cp pages/index.html pages/style.css pages/app.js pages/.nojekyll dist/pages/
cp public/icons/product-icon.png public/icons/favicon.png dist/pages/icons/
python3 -m http.server 5182 --bind 127.0.0.1 --directory dist
```

打开 http://127.0.0.1:5182/pages/ ，该子路径也用于验证项目站点的相对资源路径。

参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。首次启用 Pages 需要仓库管理权限；提交代码本身不会更改仓库设置。
