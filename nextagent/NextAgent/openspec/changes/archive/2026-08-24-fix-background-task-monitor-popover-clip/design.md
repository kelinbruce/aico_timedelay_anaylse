# fix-background-task-monitor-popover-clip 设计

## 问题（Problem）

BackgroundTaskHeaderMonitor 此前将下拉面板渲染为 chat pane header 的直接 DOM 子节点，并使用 position:absolute。共享的 PageHeader 应用 overflow:hidden 来处理 local、immersive、collaborative 三种宿主下的窄视口布局。当绝对定位面板超出 header 边界时，就会被裁剪。

## 方案（Solution）

用手动绝对定位面板替换为 Ant Design Popover：

- Popover trigger=click、placement=bottomRight，由 open/onOpenChange 状态控制。
- Popover 默认将内容 portal 到 document.body，从而逃逸祖先的 overflow:hidden。
- 面板内容（BackgroundTaskList）不变；只改变容器和定位方式。
- 响应式尺寸：width: min(440px, calc(100vw - 32px))、maxHeight: min(520px, calc(100vh - 80px))。
- 移除 Button 的 onClick 切换；由 Popover onOpenChange 处理打开/关闭。
- 通过既有的 window keydown 监听器调用 setOpen(false)，保留 Escape 关闭行为。
 - 未指定 getPopupContainer，保持默认 portal 到 document.body。

## 为什么不用其他方案（Why not other approaches）

- 单纯提高 z-index 无法绕过祖先的 overflow:hidden。
- 移除 PageHeader 的 overflow:hidden 会改变三种宿主共享的 header 布局契约。
- 用 getBoundingClientRect 手写 position:fixed 会重复实现 Popover 的能力（resize、scroll、边界检测）。
 - 项目已经在使用 Popover（如 FavoriteTurnsPanel、SessionHistorySearchControls），并在 AppProviders 中配置了 zIndexPopupBase: 100000。

## 变更文件（Files Changed）

- frontend/agent-web/src/features/background-tasks/components/BackgroundTaskMonitorPanel.tsx：用 Popover 替换 div+absolute 面板。
- frontend/agent-web/tests/BackgroundTaskMonitorPanel.test.tsx：更新 Escape 测试，断言 aria-expanded=false（Popover 在 jsdom 中通过 CSS class 隐藏，而不是移除 DOM）。
