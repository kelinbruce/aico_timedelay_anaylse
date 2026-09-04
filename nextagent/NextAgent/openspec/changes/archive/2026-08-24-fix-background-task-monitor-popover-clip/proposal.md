# fix-background-task-monitor-popover-clip

## 背景与问题（Why）

后台任务 header monitor 此前使用手动定位的 position:absolute 面板，嵌套在 chat pane header 内部。共享的 PageHeader 组件应用 overflow:hidden，以防止三种宿主模式（local、immersive、collaborative）在窄视口下出现布局溢出。这导致下拉面板在任务列表超出 header 可见区域时被裁剪，部分或完全不可见。

## 目标（Goals）

- 用 portal 到 document.body 的 Ant Design Popover 替换手动绝对定位面板，绕过祖先的 overflow:hidden
- 移除面板上所有手动定位样式（position、top、right、marginTop、zIndex、border、background、boxShadow）
- 保留受控的 open 状态、Escape 关闭以及既有的列表、输出、kill 和流式增量行为
- 使用响应式宽高以兼容窄宿主

## 非目标（Non-Goals）

- 不修改共享的 PageHeader 组件或其 overflow 规则
- 不改变后台任务 store、service 或 stream contract
- 不新增 Web API、stream event 或 persistence contract

## 变更范围（What Changes）

- agent-web-background-task-control spec MODIFIED：下拉面板渲染要求更新为允许基于 portal 的 popover（Ant Design Popover），不再要求嵌套在 header 内部的 inline position:absolute 面板
- 面板内容（BackgroundTaskList）、badge 触发器、Escape 关闭、seed fetch、kill 和输出读取行为保持不变

## 影响范围（Impact）

- Owner：agent-web（仅前端）
- 文件：BackgroundTaskMonitorPanel.tsx、BackgroundTaskMonitorPanel.test.tsx
- 无 backend、contract、DTO、persistence 或配置变更
