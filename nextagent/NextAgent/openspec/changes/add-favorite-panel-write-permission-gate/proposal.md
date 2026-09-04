## Why

`agent-web-auth-control` spec 的 "Write operation entries SHALL be disabled when user lacks AICOService.Write" requirement 以穷举方式列举了当前被 gating 的写操作入口，覆盖 `MessageInput`、Sidebar、turn-action、suggested-question、`CronTaskDashboardPage` 和 `MemoryManagePage` 六个表面。收藏列表页面（`FavoriteTurnsPanel`）未包含在该列表中：列表项的"取消收藏"按钮虽然已在实现中用 `AuthGate` 包裹，但未被 spec 声明；页头"批量取消收藏"入口按钮则完全没有权限校验——远程只读用户（仅有 `AICOService.View`，缺少 `AICOService.Write`）可以进入批量模式，勾选收藏后确认，直接触发 `annotationService.upsertAnnotation` 写操作。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 远程只读用户（缺少 `AICOService.Write`）在收藏列表页面的以下写操作入口 MUST 被禁用并展示权限提示：单个收藏的取消收藏按钮、页头批量取消收藏入口按钮。
- 批量取消收藏入口被禁用后，批量选择模式 SHALL 不可进入，批量确认路径 SHALL 不可达。
- 上述入口在有 `AICOService.Write` 时 MUST 保持可用，既有业务禁用条件（`batchMode`、`pendingRemovalKey` 等）MUST 继续优先于权限禁用。
- local 模式行为不变，`useUserOps()` 返回 `null` 时全部放行。

**非目标：**

- 不修改后端 API、runtime、gateway persistence 或 owner scope。
- 不修改 `AuthGate`/`AuthWrapper`/`useUserOps` 的行为或接口。
- 不对收藏浏览、搜索、日期过滤、分页、展开正文等只读操作做权限 gating。
- 不修改 TurnBlock 内的 favorite 按钮 gating（已由既有第 8 项覆盖）。

## What Changes

- 修改 `agent-web-auth-control` spec 的 "Write operation entries SHALL be disabled when user lacks AICOService.Write" requirement 的 gated 范围：在现有 16 项基础上新增 `FavoriteTurnsPanel` 的 2 个写操作入口（单个取消收藏、批量取消收藏入口）。
- 修改 `FavoriteTurnsPanel.tsx`，用 `AuthGate` 包裹页头"批量取消收藏"入口按钮；单个取消收藏按钮的既有 `AuthGate` 包裹保持不变。
- 新增组件测试验证无 Write 时批量入口被禁用且不触发写请求。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.7 标注对话`：远程只读用户无法在收藏列表页面取消单个收藏或进入批量取消收藏流程，入口被禁用并展示权限提示；收藏浏览保持可用。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.13 查看收藏列表` → `specs/agent-web-auth-control/spec.md`
  - 功能边界：Agent Web 收藏列表页面的写操作入口（单个取消收藏、批量取消收藏）在远程只读用户下被禁用。
  - 系统质量属性：安全、可维护性。
  - 映射说明：canonical spec 为 `specs/favorite-turn-list/spec.md`（浏览语义）；本次触及 `agent-web-auth-control` spec 的 Write gating requirement。

## 影响范围（Impact）

- 远程只读用户在收藏列表页面的单个取消收藏与批量取消收藏入口呈现禁用态并展示权限提示 Tooltip。
- 后端 API、runtime、gateway persistence、owner scope 和 agent scope 不受影响。
- `AuthGate`/`AuthWrapper`/`useUserOps` 的行为和接口不变。
- 前端组件测试需覆盖新增 gating 场景。
