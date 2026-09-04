## 背景与问题（Why）

NextAgent 前端通过 Prel 注入的 `HostSiteContext.user.ops` 携带当前用户的操作权限（`AICOService.View`、`AICOService.Write`），但目前仅 share 功能消费了 ops（`ShareSettingsModal`、`shareService` 的 `X-Viewer-Ops` header），没有任何 UI 入口基于 ops 做权限控制。所有写操作入口（发送消息、编辑、重试、取消、附件上传、新建会话、重命名会话、标注等）对所有用户完全开放，无法区分只读用户和读写用户。

产品需要支持两种操作权限层级：
- `AICOService.View`（只读）：可查看历史会话、对话内容、推荐问题、run graph，但不能做任何影响后端数据的写操作。
- `AICOService.Write`（读写）：拥有全部操作权限。

当用户只有 View 权限时，所有写操作入口必须保持可见但禁用，并通过 Tooltip 提示用户联系管理员添加具备 `AICOService.Write` 操作的角色。当用户既无 View 也无 Write 时，主内容区展示全页无权限提示。

## 变更范围（What Changes）

- 新增 `useUserOps()` hook，复用现有 `AppHostContext` 读取 `site.user.ops`，封装 local/remote 语义，返回 `readonly string[] | null`（`null` = local 放行，`[]` = remote 无权限降级，非空数组 = remote 有 ops）。
- 新增 `AICOServiceOperation` 枚举，定义 `View = "AICOService.View"` 和 `Write = "AICOService.Write"`，对应 Prel 注入的原始字符串。
- 新增 `AuthGate` 组件，对需要 Write 权限的可见 UI 入口做禁用 + Tooltip 包裹。`AuthGate` 内部通过 `useUserOps()` 判断权限，local 模式直接放行。
- 新增 `AuthWrapper` 组件，对无视觉表现的隐藏元素（如隐藏 file input）做条件渲染。
- 修改 `ChatPage.tsx`，将手写的 `isRemoteMode ? (host?.site?.user?.ops ?? null) : null` 替换为 `useUserOps()`，语义完全等价。
- 修改 `MessageInput.tsx`，用 `AuthGate` 包裹发送、编辑确认、取消编辑、停止、附件上传按钮，禁用拖放区，禁用 slash 命令中的写操作命令（`/retry`、`/edit`、`/clear`）。
- 修改 `Sidebar.tsx`，用 `AuthGate` 禁用新建会话按钮和重命名会话菜单项。
- 修改 `TurnBlock.tsx`，用 `AuthGate` 禁用重试、编辑、点赞/踩、收藏标注按钮。
- 修改 `SuggestedQuestions.tsx`，对触发提交（`isSend: true`）的推荐问题点击做禁用。
- 新增全页无权限提示组件，在 ops 为空数组时渲染。
- 新增全部权限提示文案的 i18n key（zh-CN / en-US）。
- 在 spec 中新增治理 requirement：未来新增写操作 UI 入口应考虑使用 `AuthGate` 或 `AuthWrapper` 做权限控制。

## 非目标（Non-Goals）

- 不修改后端 API、stream event、runtime lifecycle、gateway persistence、owner scope 或 agent scope。
- 不修改 `HostSiteContext` 的定义或 Prel 注入方式。
- 不修改 local 模式的行为（local 模式 `useUserOps()` 返回 `null`，全放行）。
- 不修改 `ShareSettingsModal`、`ShareModeBar`、`shareService` 的现有 ops 消费方式。
- 不实现基于角色（roles）的权限控制。
- 不引入权限系统的运行时动态刷新或观测变更。
- 不引入架构测试或 lint 规则强制约束写操作入口必须包裹权限控制（治理层约束见 spec requirement）。
- 不修改模型选择、prompt 组装、session 生命周期等后端行为。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-web-auth-control`：前端基于用户操作权限的 UI 控制能力，定义 `useUserOps` hook、`AuthGate`/`AuthWrapper` 组件、`AICOServiceOperation` 枚举、写操作入口禁用规则、空权限全页提示和治理约束。

### 修改的 Capability
- 无。本 change 新增前端能力，不修改已有 capability 的行为契约。

## 影响范围（Impact）

- **前端代码**：
  - 新增 `src/features/auth/authEnums.ts`（`AICOServiceOperation` 枚举）。
  - 新增 `src/features/auth/useUserOps.ts`（`useUserOps` hook）。
  - 新增 `src/features/auth/AuthGate.tsx`（禁用 + Tooltip 权限门）。
  - 新增 `src/features/auth/AuthWrapper.tsx`（隐藏权限门）。
  - 新增 `src/features/auth/PermissionUnavailable.tsx`（全页无权限提示）。
  - 修改 `src/pages/ChatPage.tsx`（`userOps` 读取换 `useUserOps()`）。
  - 修改 `src/features/composer/components/MessageInput.tsx`（写操作入口 `AuthGate` 包裹）。
  - 修改 `src/features/sidebar/components/Sidebar.tsx`（新建会话、重命名 `AuthGate` 禁用）。
  - 修改 `src/features/chat/components/TurnBlock.tsx`（重试、编辑、标注 `AuthGate` 禁用）。
  - 修改 `src/features/suggested-questions/components/SuggestedQuestions.tsx`（推荐问题点击禁用）。
  - 修改 `src/i18n/resources/zh-CN.ts`、`src/i18n/resources/en-US.ts`（权限提示文案）。
- **不涉及**：后端 API、stream event、runtime lifecycle、gateway persistence、sandbox、owner scope、agent scope。

## 验证入口（Validation）

- `useUserOps` unit tests：local 返回 `null`、remote 有 ops 返回数组、remote 缺 ops 返回 `[]`。
- `AuthGate` unit tests：local 放行、有 Write 放行、无 Write 禁用并显示 Tooltip。
- `AuthWrapper` unit tests：local 放行、有权限渲染 children、无权限渲染 `null`。
- `ChatPage` 语义等价测试：`useUserOps()` 替换前后三种输入返回值一致。
- `MessageInput` component tests：无 Write 时 `btn-send`/`btn-stop`/`btn-confirm-edit`/`btn-cancel-edit`/`attach-button` disabled，`message-textarea` 仍可用，拖放区禁用，slash 写命令 disabled。
- `Sidebar` component tests：无 Write 时新建会话按钮 disabled、重命名菜单项 disabled。
- `TurnBlock` component tests：无 Write 时 `btn-retry-ai`/`btn-edit-user`/`annotation-*` disabled。
- `SuggestedQuestions` component tests：无 Write 时推荐问题点击禁用。
- 全页无权限提示测试：ops 为 `[]` 时主内容区渲染无权限提示，不渲染 composer。
- i18n 完整性测试：zh-CN 和 en-US 均包含所有新增权限提示 key。
- `openspec validate agent-web-auth-control --strict`。
