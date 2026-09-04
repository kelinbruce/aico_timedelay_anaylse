## 问题

`agent-web-auth-control` spec 的 "Write operation entries SHALL be disabled when user lacks AICOService.Write" requirement 以穷举方式列举了当前被 gating 的写操作入口，未包含收藏列表页面（`FavoriteTurnsPanel`）。实现中列表项"取消收藏"按钮已有 `AuthGate` 包裹（来自收藏面板共享化重构），但页头"批量取消收藏"入口按钮没有权限校验：远程只读用户可以进入批量模式并触发 `annotationService.upsertAnnotation` 写操作。本 change 将收藏列表页面的写操作入口纳入现有 gating 机制，并把已实现的单个取消收藏 gating 一并声明进 spec。

## 设计决策

### 复用现有 AuthGate 机制

收藏列表页面的写操作入口与已 gating 的入口（TurnBlock、Sidebar、MessageInput、CronTaskDashboardPage、MemoryManagePage）语义完全一致：都是远程用户下基于 `AICOServiceOperation.Write` 的 UI 禁用。因此 MUST 复用现有 `AuthGate` 组件，不引入新的权限判断机制，也不在 `batchRemoveFavorites` 回调内新增第二套权限判断。

### Gating 范围

**收藏列表页面（`FavoriteTurnsPanel.tsx`）gating 2 个写操作入口：**

1. 列表项"取消收藏"按钮 — `Popconfirm onConfirm={() => removeFavorite(entry)}` 触发按钮，调用 `annotationService.upsertAnnotation`（既有实现已包裹，本 change 声明进 spec）
2. 页头"批量取消收藏"入口按钮 — `Button onClick={startBatchMode}`，进入批量模式后经 `ShareModeBar` 确认逐条调用 `annotationService.upsertAnnotation`（本 change 新增 `AuthGate` 包裹）

### 不 gating 的操作

- 收藏浏览、会话分组、搜索、日期过滤、分页、展开正文、会话定位跳转 — 均为读操作或本地导航。
- 批量模式内的勾选与取消勾选 — 批量模式只能经被 gating 的入口进入，无权限用户不可达。

### 批量确认路径的防护方式

批量确认（`ShareModeBar`）只在 `batchMode === true` 时渲染，而 `batchMode` 只能由 `startBatchMode` 置位。入口按钮被 `AuthGate` 禁用后，无权限用户无法进入批量模式，确认路径自然不可达，MUST NOT 在 `ShareModeBar` 层面重复 gating（与 `ChatPage` 两个既有 `ShareModeBar` 用法的入口控制策略同形同策）。

### AuthGate 与既有 disabled 的叠加

单个取消收藏按钮既有 `disabled={batchMode || !canWriteFavorites || pendingRemovalKey !== null}` 业务禁用逻辑。`AuthGate` 在有权限时直接渲染 children 不修改；无权限时通过注入 `disabled` 或 `pointerEvents: none` 禁用。两层不冲突，既有业务禁用条件继续优先。

## 验证策略

| 验证内容 | 验证层级 | 覆盖方式 |
|----------|---------|---------|
| 收藏列表批量入口 Write gating | 组件测试 | 渲染 `FavoriteTurnsPanel`，验证无 Write 时"批量取消收藏"按钮 disabled 且 `upsertAnnotation` 未被调用 |
| 收藏列表单个取消收藏 Write gating | 组件测试 | 既有用例 `disables cancellation when the remote user lacks write permission` 验证无 Write 时按钮 disabled |
| 有 Write / local 模式可用 | 组件测试 | 既有用例验证完整取消收藏流程在 local 模式可用 |
| 只读操作不受 gating 影响 | 组件测试 | 既有用例验证收藏浏览、搜索、过滤、分页在无 Write 时可用 |
| spec 一致性 | OpenSpec 验证 | `openspec validate --all --strict` |
