## Why

`agent-web-auth-control` spec 的 "Write operation entries SHALL be disabled when user lacks AICOService.Write" requirement 以穷举方式列举了当前被 gating 的写操作入口，覆盖 `MessageInput`、Sidebar、turn-action 和 suggested-question 四个表面。但定时任务页面（`CronTaskDashboardPage`）和记忆管理页面（`MemoryManagePage`）的写操作入口未包含在该列表中，导致远程只读用户（仅有 `AICOService.View`，缺少 `AICOService.Write`）可以在定时任务页面创建、编辑、删除和执行定时任务，以及在记忆管理页面新建、编辑、删除、归档、置顶、发布/取消发布、复制和导入长期记忆。这些操作均触发后端写 API（`cronTaskService.create/update/delete/execute`、`memoryService.patch/delete/publish/unpublish/copy/batchCreate`），但前端未用 `AuthGate` 拦截。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 远程只读用户（缺少 `AICOService.Write`）在定时任务页面的以下写操作入口 MUST 被禁用并展示权限提示：手动创建任务、从会话创建任务、编辑任务、删除任务、执行任务。
- 远程只读用户在记忆管理页面的以下写操作入口 MUST 被禁用并展示权限提示：导入记忆、新建记忆、编辑记忆、置顶/取消置顶、发布/取消发布、归档/取消归档、删除记忆、复制共享记忆到我的、取消发布共享记忆、确认导入。
- 上述入口在有 `AICOService.Write` 时 MUST 保持可用，既有业务禁用条件（`actionLoading`、表单校验等）MUST 继续优先于权限禁用。
- local 模式行为不变，`useUserOps()` 返回 `null` 时全部放行。

**非目标：**

- 不修改后端 API、runtime、gateway persistence 或 owner scope。
- 不修改 `AuthGate`/`AuthWrapper`/`useUserOps` 的行为或接口。
- 不对定时任务和记忆管理页面的只读操作（浏览、查看详情、执行记录列表重试）做权限 gating。
- 不对导出和下载模板做权限 gating（它们不触发后端写）。
- 不新增架构测试或 lint 规则强制约束。
- 不修改收藏列表（`FavoriteTurnsPanel`）已有 gating。

## What Changes

- 修改 `agent-web-auth-control` spec 的 "Write operation entries SHALL be disabled when user lacks AICOService.Write" requirement 的 gated 范围：在现有 9 项基础上新增定时任务页面 5 个写操作入口和记忆管理页面 11 个写操作入口。
- 修改 `CronTaskDashboardPage.tsx`，用 `AuthGate` 包裹手动创建、从会话创建、编辑、删除和执行任务按钮/入口。
- 修改 `MemoryManagePage.tsx`，用 `AuthGate` 包裹导入、新建、编辑、置顶、发布/取消发布、归档/取消归档、删除、复制共享、取消发布共享和确认导入按钮/入口。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.13 管理定时任务`：远程只读用户无法在定时任务页面创建、编辑、删除和执行定时任务，入口被禁用并展示权限提示。
- `F-1.14 管理长期记忆`：远程只读用户无法在记忆管理页面新建、编辑、删除、归档、置顶、发布/取消发布、复制和导入长期记忆，入口被禁用并展示权限提示。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.9 Cron 工具` → `specs/agent-web-auth-control/spec.md`
  - 功能边界：Agent Web 定时任务页面的写操作入口（创建、编辑、删除、执行）在远程只读用户下被禁用。
  - 系统质量属性：安全、可维护性。
  - 映射说明：canonical spec 为 `specs/cron-task/spec.md`（如有）；本次触及 `agent-web-auth-control` spec 的 Write gating requirement。

- `FN-8.15 管理长期记忆` → `specs/agent-web-auth-control/spec.md`
  - 功能边界：Agent Web 记忆管理页面的写操作入口（新建、编辑、删除、归档、置顶、发布/取消发布、复制、导入）在远程只读用户下被禁用。
  - 系统质量属性：安全、可维护性。
  - 映射说明：canonical spec 为 `specs/long-term-memory-management/spec.md`（如有）；本次触及 `agent-web-auth-control` spec 的 Write gating requirement。

## 影响范围（Impact）

- 远程只读用户在定时任务页面和记忆管理页面的写操作入口呈现禁用态并展示权限提示 Tooltip。
- 后端 API、runtime、gateway persistence、owner scope 和 agent scope 不受影响。
- `AuthGate`/`AuthWrapper`/`useUserOps` 的行为和接口不变。
- 前端组件测试需覆盖新增 gating 场景。
