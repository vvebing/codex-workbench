# UI 一致性检查

范围：当前 git status 的已暂存、未暂存与未跟踪前端 TSX/CSS，按文件清单审阅；不重置已有改动。非 UI 的协议、状态、服务端和测试改动不机械套用组件替换。

共覆盖 64 个 UI / 样式文件（含已删除入口）。共享组件优先使用现有 Button、IconButton、Modal、Menu、SelectField、ScrollArea、ErrorNotice；库中没有 Input，因此沿用原生 input/textarea 和统一 settingsInputClass。

| 文件                                                                                                          | 处理与保留理由                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/components/ImagePreview.tsx](../src/components/ImagePreview.tsx)                                         | 复用图片渲染；保留缩略图点击区域、焦点和图片预览语义。                                                                                              |
| [src/components/ImageViewer.tsx](../src/components/ImageViewer.tsx)                                           | 共享图片查看器及工具按钮，保留缩放/拖动专用逻辑。                                                                                                   |
| [src/components/menu.css](../src/components/menu.css)                                                         | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |
| [src/components/ui.tsx](../src/components/ui.tsx)                                                             | 共享组件实现；错误关闭复用 IconButton，未新增另一套输入组件。                                                                                       |
| [src/features/approvals/ApprovalQueue.tsx](../src/features/approvals/ApprovalQueue.tsx)                       | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/composer/Completions.tsx](../src/features/composer/Completions.tsx)                             | 保留 option/listbox 和防止编辑器失焦逻辑，已用 ScrollArea。                                                                                         |
| [src/features/composer/Composer.tsx](../src/features/composer/Composer.tsx)                                   | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/composer/ContextUsage.tsx](../src/features/composer/ContextUsage.tsx)                           | 保留计量与 Popover 专用触发器。                                                                                                                     |
| [src/features/composer/MessageEditor.tsx](../src/features/composer/MessageEditor.tsx)                         | Tiptap 编辑器与结构化引用节点，使用主题 tokens。                                                                                                    |
| [src/features/composer/QueuedTasks.tsx](../src/features/composer/QueuedTasks.tsx)                             | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/composer/editor.css](../src/features/composer/editor.css)                                       | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |
| [src/features/connection/AppServerUpdate.tsx](../src/features/connection/AppServerUpdate.tsx)                 | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/conversation/AgentDrawer.tsx](../src/features/conversation/AgentDrawer.tsx)                     | 返回/刷新用 IconButton；错误和滚动区复用组件；保留需 ref 自动聚焦的关闭控件与层级导航。                                                             |
| [src/features/conversation/AgentEntry.tsx](../src/features/conversation/AgentEntry.tsx)                       | 保留多字段代理行、带 ref 的状态触发器，复用 ScrollArea。                                                                                            |
| [src/features/conversation/AsyncQuestions.tsx](../src/features/conversation/AsyncQuestions.tsx)               | 输入复用 settingsInputClass；保留原生 radio 与回答滚动定位。                                                                                        |
| [src/features/conversation/Details.tsx](../src/features/conversation/Details.tsx)                             | 已用 Radix Tabs 与 ResourceScrollArea；合并为文件、Git、工作区三个页签。                                                                            |
| [src/features/conversation/Markdown.tsx](../src/features/conversation/Markdown.tsx)                           | 代码复制复用 Button，保留悬浮显隐、触屏可见与复制反馈。                                                                                             |
| [src/features/conversation/MermaidDiagram.tsx](../src/features/conversation/MermaidDiagram.tsx)               | 文字/图标工具用 Button/IconButton，保留图表状态。                                                                                                   |
| [src/features/conversation/OperationDetails.tsx](../src/features/conversation/OperationDetails.tsx)           | 复制用 IconButton，记录区用 ScrollArea；保留文件切换控件。                                                                                          |
| [src/features/conversation/PromptDirectory.tsx](../src/features/conversation/PromptDirectory.tsx)             | 关闭复用 IconButton；保留目录行、搜索组合输入和悬浮目录触发器。                                                                                     |
| [src/features/conversation/ResourceScrollArea.tsx](../src/features/conversation/ResourceScrollArea.tsx)       | 复用共享 ScrollArea 并管理资源位置恢复。                                                                                                            |
| [src/features/conversation/ThreadTools.tsx](../src/features/conversation/ThreadTools.tsx)                     | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/conversation/Timeline.tsx](../src/features/conversation/Timeline.tsx)                           | 删除重复结果区参数；保留工具事件、消息操作和历史滚动结构。                                                                                          |
| [src/features/conversation/TurnResults.tsx](../src/features/conversation/TurnResults.tsx)                     | 收敛为本轮变更；Button/IconButton/Menu/ScrollArea，普通问答隐藏。                                                                                   |
| [src/features/conversation/markdown.css](../src/features/conversation/markdown.css)                           | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |
| [src/features/conversation/prompt-directory.css](../src/features/conversation/prompt-directory.css)           | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |
| [src/features/files/ConversationWorkspace.tsx](../src/features/files/ConversationWorkspace.tsx)               | 使用 react-resizable-panels 保持分栏与编辑器生命周期。                                                                                              |
| [src/features/files/FileImagePreview.tsx](../src/features/files/FileImagePreview.tsx)                         | 复用 ImageViewer，保留编辑区域布局。                                                                                                                |
| [src/features/files/FileLinkContext.tsx](../src/features/files/FileLinkContext.tsx)                           | 打开当前文件动作改 Button；内容链接仍保留 anchor 语义。                                                                                             |
| [src/features/files/FileWorkspace.tsx](../src/features/files/FileWorkspace.tsx)                               | 工具栏已用 Button/IconButton；错误复用 ErrorNotice；保留文件 tab 键盘行为、状态提示与冲突警示。                                                     |
| [src/features/files/ImageFileAnchor.tsx](../src/features/files/ImageFileAnchor.tsx)                           | 关闭状态提示动作改 Button；图片链接复用 ImagePreview。                                                                                              |
| [src/features/files/MarkdownPreview.tsx](../src/features/files/MarkdownPreview.tsx)                           | 复用 Markdown/ScrollArea，保留图片占位与内容排版。                                                                                                  |
| [src/features/files/MonacoEditor.tsx](../src/features/files/MonacoEditor.tsx)                                 | 编辑器适配器，字体与颜色从共享主题读取，不替换编辑器原生控件。                                                                                      |
| [src/features/files/files.css](../src/features/files/files.css)                                               | 共享 tokens 或组件专用样式；保留内容、编辑器、树形/菜单排版所需规则，移除废弃 Git 图标按钮规则；文件对话框输入复用统一表单类。                      |
| [src/features/navigation/CompletionNotifications.tsx](../src/features/navigation/CompletionNotifications.tsx) | 关闭已用 IconButton；保留可点击复合通知卡片。                                                                                                       |
| [src/features/navigation/HistoryDialog.tsx](../src/features/navigation/HistoryDialog.tsx)                     | 已删除的重复历史入口，不恢复。                                                                                                                      |
| [src/features/navigation/SearchDialog.tsx](../src/features/navigation/SearchDialog.tsx)                       | 重试/分页用 Button，错误用 ErrorNotice；保留 cmdk 输入与结果行。                                                                                    |
| [src/features/navigation/SectionControls.tsx](../src/features/navigation/SectionControls.tsx)                 | 复用 Button/Modal/SelectField/ErrorNotice 和表单样式；确认区域保留警示语义。                                                                        |
| [src/features/navigation/Sidebar.tsx](../src/features/navigation/Sidebar.tsx)                                 | 新建/搜索/待办用 Button；保留环境 tab、展开控制和多字段树行。                                                                                       |
| [src/features/navigation/ThreadMenu.tsx](../src/features/navigation/ThreadMenu.tsx)                           | 复用 Radix 菜单/共享组件，输入统一；会话导出与补丁共用 exportText。                                                                                 |
| [src/features/navigation/search.css](../src/features/navigation/search.css)                                   | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |
| [src/features/projects/ProjectWorkspace.tsx](../src/features/projects/ProjectWorkspace.tsx)                   | 共享表单、SelectField、Button/ErrorNotice；工作区外层复用 ResourceScrollArea，命令输出复用 ScrollArea；新建入口用 Modal/SelectField，默认设置折叠。 |
| [src/features/settings/AppServerVersion.tsx](../src/features/settings/AppServerVersion.tsx)                   | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/settings/AppearanceSettings.tsx](../src/features/settings/AppearanceSettings.tsx)               | 已用共享组件与表单样式；主题原生 radio 保留分组选择语义。                                                                                           |
| [src/features/settings/ArchivedThreads.tsx](../src/features/settings/ArchivedThreads.tsx)                     | 刷新/分页/错误复用 IconButton/Button/ErrorNotice；搜索保持复合输入框。                                                                              |
| [src/features/settings/CapabilityPanel.tsx](../src/features/settings/CapabilityPanel.tsx)                     | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/settings/ConnectionSettings.tsx](../src/features/settings/ConnectionSettings.tsx)               | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/settings/EnvironmentTools.tsx](../src/features/settings/EnvironmentTools.tsx)                   | 操作错误统一 ErrorNotice；结构化技能/Hook条目错误仍是内联详情。                                                                                     |
| [src/features/settings/SettingsDialog.tsx](../src/features/settings/SettingsDialog.tsx)                       | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/settings/settings-ui.tsx](../src/features/settings/settings-ui.tsx)                             | 复用已有共享组件与表单样式；操作错误统一 ErrorNotice，保留领域内容结构。                                                                            |
| [src/features/shell/App.tsx](../src/features/shell/App.tsx)                                                   | 移除重复结果区跳转；设置动作复用 Button；保留环境选择卡片与文件工作区返回栏。                                                                       |
| [src/features/shell/BranchChanges.tsx](../src/features/shell/BranchChanges.tsx)                               | Radix Tooltip 下分支/数量组合触发器，保留紧凑顶栏布局和响应式行为。                                                                                 |
| [src/features/shell/FilesPanel.tsx](../src/features/shell/FilesPanel.tsx)                                     | 新建/折叠/刷新/更多操作用 IconButton；错误与表单统一；保留树行层级和右键语义。                                                                      |
| [src/features/shell/GitFileList.tsx](../src/features/shell/GitFileList.tsx)                                   | 树形文件列表及目录 details，保留原生展开语义和主题 CSS。                                                                                            |
| [src/features/shell/GitPanel.tsx](../src/features/shell/GitPanel.tsx)                                         | 工具栏用 IconButton；保留文件树行与 diff 选择，移除 Git 写操作。                                                                                    |
| [src/features/shell/GitTools.tsx](../src/features/shell/GitTools.tsx)                                         | 只读操作使用共享 Menu/MenuItem/IconButton/Button/ErrorNotice。                                                                                      |
| [src/features/shell/ShellPanels.tsx](../src/features/shell/ShellPanels.tsx)                                   | 已用 react-resizable-panels，保留拖动和键盘调整。                                                                                                   |
| [src/features/shell/WorkspacePicker.tsx](../src/features/shell/WorkspacePicker.tsx)                           | 错误与输入统一；保留目录 combobox/listbox、键盘补全及目录选择行。                                                                                   |
| [src/features/shell/git.css](../src/features/shell/git.css)                                                   | 共享 tokens 或组件专用样式；保留内容、编辑器、树形/菜单排版所需规则，移除废弃 Git 图标按钮规则；文件对话框输入复用统一表单类。                      |
| [src/features/task-center/TaskCenter.tsx](../src/features/task-center/TaskCenter.tsx)                         | 已有共享组件；多行任务按钮保留卡片导航语义。                                                                                                        |
| [src/main.tsx](../src/main.tsx)                                                                               | 样式层顺序与主题初始化，未引入新控件。                                                                                                              |
| [src/styles.css](../src/styles.css)                                                                           | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |
| [src/theme.css](../src/theme.css)                                                                             | 共享主题 tokens、布局或内容渲染规则；不将富文本/菜单/编辑器语义替换为普通表单控件。                                                                 |

## 边界

原生控件不是一律错误：文件 tab、文件树行、cmdk 列表、radio、Tiptap/Monaco、拖动分栏和复合通知有自己的语义及焦点管理。此次移除的是重复实现通用组件的部分，保留这些专用交互，并使用共享颜色、字体和间距规则。

Git 写操作与独立交付报告已从实现中删除。不是仅禁用按钮或保留不可达的命令路径。

## 验证记录

完整 `npm run check` 通过：95 个单测文件中的 620 项测试、18 项集成测试，以及仓库、类型、接口清单、ESLint、Prettier 检查。

浏览器回归 23 项全部通过：本轮变更、Git 只读工具（两种权限配置）、项目空间、模板、能力面板共 9 项；文件创建/复制/删除与冲突、编辑器外观、搜索、审批/回答、设置工具、分区、审查/参考资料及迟到 diff 隔离等原有流程 14 项。此次未执行全量浏览器用例或全页面视觉快照比对。
