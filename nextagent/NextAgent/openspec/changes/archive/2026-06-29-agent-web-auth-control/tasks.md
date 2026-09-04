## 1. 基础设施

- [x] 1.1 创建 `AICOServiceOperation` 枚举，定义 `View = "AICOService.View"` 和 `Write = "AICOService.Write"`，路径 `frontend/agent-web/src/features/auth/authEnums.ts`。
  验证：`cat frontend/agent-web/src/features/auth/authEnums.ts | grep "AICOServiceOperation"`；单元测试验证枚举值与 Prel site context 字符串一致。
  来源：spec requirement "AICOServiceOperation SHALL define View and Write"

- [x] 1.2 创建 `useUserOps()` hook，路径 `frontend/agent-web/src/features/auth/useUserOps.ts`。内部通过 `useContext(AppHostContext)` 读取 `mode` 和 `site.user.ops`，返回 `readonly string[] | null`：local 返回 `null`，remote 返回 `ops ?? []`。`AppHostContext` 为 null 时返回 `null`（安全降级到 local 语义）。
  验证：单元测试覆盖四种场景：local 返回 `null`、remote 有 ops 返回数组、remote 缺 user 返回 `[]`、AppHostContext 不可用返回 `null`。
  来源：spec requirement "useUserOps hook SHALL provide user ops"

- [x] 1.3 创建 `AuthGate` 组件，路径 `frontend/agent-web/src/features/auth/AuthGate.tsx`。签名：`AuthGate({ requiredOps: AICOServiceOperation[], tooltipKey?: string, children: ReactNode })`。内部通过 `useUserOps()` 判断：`null`（local）或 ops 全命中时渲染 children 不修改；缺少权限时渲染 disabled children + Tooltip。disabled 注入方式：Antd Button 通过 `cloneElement` 注入 `disabled={true}`，非 Antd 元素通过 `pointerEvents: "none"` + `opacity` 灰显。默认 `tooltipKey` 为 `"auth.noWritePermission"`。
  验证：AuthGate unit tests：local 放行不加 disabled、有 Write 放行、无 Write 时 disabled + Tooltip 存在、空数组 `[]` 时 disabled + Tooltip 存在。
  来源：spec requirement "AuthGate SHALL disable visible write operation entries"

- [x] 1.4 创建 `AuthWrapper` 组件，路径 `frontend/agent-web/src/features/auth/AuthWrapper.tsx`。签名：`AuthWrapper({ requiredOps: AICOServiceOperation[], fallback?: ReactNode, children: ReactNode })`。内部通过 `useUserOps()` 判断：`null`（local）或 ops 全命中时渲染 children；否则渲染 `fallback ?? null`。
  验证：AuthWrapper unit tests：local 放行、有权限放行、无权限返回 null、无权限有 fallback 返回 fallback。
  来源：spec requirement "AuthWrapper SHALL conditionally render children"

- [x] 1.5 创建 `PermissionUnavailable` 组件，路径 `frontend/agent-web/src/features/auth/PermissionUnavailable.tsx`。使用 i18n key `auth.noPermissionTitle` 和 `auth.noPermissionDescription` 渲染全页无权限提示。居中展示，风格与现有 `Spin` loading 页一致（`minHeight: 100vh`, `display: grid`, `placeItems: center`）。
  验证：PermissionUnavailable unit tests：渲染 title 和 description 文案、i18n key 正确引用。
  来源：spec requirement "Main page SHALL render unavailable state"

## 2. ChatPage ops 读取语义等价替换

- [x] 2.1 修改 `ChatPage.tsx`，将 `const isRemoteMode = host?.mode === "immersive" || host?.mode === "piu"; const userOps = isRemoteMode ? (host?.site?.user?.ops ?? null) : null;` 替换为 `const userOps = useUserOps();`。移除不再使用的 `isRemoteMode` 变量（如其他地方仍使用则保留）。确认 `userOps` 传给 `ShareSettingsModal` 的 prop 类型和行为不变。
  验证：ChatPage 语义等价测试：local 返回 `null`、remote 有 ops 返回数组、remote 缺 ops 返回 `[]`（原 `null`，但 `ShareSettingsModal` 对 `[]` 和 `null` 行为一致）。测试断言 `ShareSettingsModal` 仍接收 `userOps` prop。
  来源：spec requirement "ChatPage SHALL read userOps via useUserOps"

## 3. 写操作入口权限控制

- [x] 3.1 在 `MessageInput.tsx` 中用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹以下写操作入口：发送按钮（`btn-send`）、编辑确认（`btn-confirm-edit`）、取消编辑（`btn-cancel-edit`）、停止按钮（`btn-stop`）、附件上传按钮（`attach-button`）。用 `AuthWrapper` 包裹隐藏 file input（`type="file"`），无 Write 时不渲染。禁用拖放区（`onDrop`/`onDragOver` 在无 Write 时不触发 `handleDrop`）。textarea 保持不禁用。
  验证：component test：ops=["AICOService.View"] 时 `btn-send`/`btn-stop`/`btn-confirm-edit`/`btn-cancel-edit`/`attach-button` present but disabled，`message-textarea` present and NOT disabled，无 `<input type="file">`，拖放不触发附件添加；ops=["AICOService.View","AICOService.Write"] 时全部 present and NOT disabled。
  来源：spec requirement "Write operation entries SHALL be disabled"

- [x] 3.2 在 `MessageInput.tsx` 中扩展 slash 命令权限控制：在 `ComposerCommandContext` 中新增 `hasWritePermission: boolean` 字段。修改 `/retry`、`/edit`、`/clear` 的 `isEnabled` 判断，同时检查 `hasWritePermission`。无 Write 时 `disabledReason` 使用 i18n key `auth.slashNoWritePermission`。`/help` 不受影响。
  验证：component test：ops=["AICOService.View"] 时 `/retry`、`/edit`、`/clear` 在 slash 面板显示 disabled 且 disabledReason 为权限提示，`/help` 正常 enabled。
  来源：spec requirement "Write operation entries SHALL be disabled" (slash commands)

- [x] 3.3 在 `Sidebar.tsx` 中用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 禁用新建会话按钮（`sidebar-new-session-shortcut` 的 `NavButton`）。在 `renderSessionActions` 的 menu items 中，将 rename 菜单项设为 `disabled: true`（通过 `useUserOps()` 判断）。
  验证：component test：ops=["AICOService.View"] 时 `sidebar-new-session-shortcut` present but disabled，rename 菜单项 present but disabled；ops=["AICOService.View","AICOService.Write"] 时两者 present and NOT disabled。
  来源：spec requirement "Write operation entries SHALL be disabled" (sidebar)

- [x] 3.4 在 `TurnBlock.tsx` 中用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 禁用以下按钮：重试（`btn-retry-ai`）、编辑（`btn-edit-user`）、点赞（`annotation-like`）、踩（`annotation-dislike`）、收藏（`annotation-favorite`）。
  验证：component test：ops=["AICOService.View"] 时 `btn-retry-ai`/`btn-edit-user`/`annotation-like`/`annotation-dislike`/`annotation-favorite` present but disabled；ops=["AICOService.View","AICOService.Write"] 时全部 present and NOT disabled。
  来源：spec requirement "Write operation entries SHALL be disabled" (turn actions)

- [x] 3.5 在 `SuggestedQuestions.tsx` 中用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 禁用推荐问题点击（`suggested-question-item`）。无 Write 时问题列表仍可见但不可点击。
  验证：component test：ops=["AICOService.View"] 时 `suggested-question-item` present but not clickable（点击不触发 `onQuestionClick`）；ops=["AICOService.View","AICOService.Write"] 时正常点击。
  来源：spec requirement "Write operation entries SHALL be disabled" (suggested questions)

- [x] 3.6 在 `MessageInput.tsx` 的更多菜单（`btn-more-menu`）中，将 reload 菜单项设为 `disabled: true`（通过 `useUserOps()` 判断无 Write 时禁用）。
  验证：component test：ops=["AICOService.View"] 时 `btn-more-menu` 可点击但 reload 菜单项 disabled；ops=["AICOService.View","AICOService.Write"] 时 reload 正常 enabled。
  来源：spec requirement "Write operation entries SHALL be disabled" (more menu reload)

## 4. 空权限全应用覆盖

- [x] 4.1 在 `ImmersiveApp.tsx` 中提取 `ImmersiveContent` 内部组件，调用 `useUserOps()`，当返回 `[]` 时渲染 `PermissionUnavailable` 覆盖所有路由（包括 `/shared/:shareId`）。在 `AIAgentPiuRuntime.tsx` 中提取 `PiuContent` 内部组件做同样判断。`ChatPage.tsx` 不再做空权限判断。
  验证：component test：ops=[] 时 ImmersiveApp 渲染 `PermissionUnavailable`，`immersive-shell` 不在 DOM，`SharedConversationPage` 不在 DOM；ops=null（local）时不渲染 `PermissionUnavailable`，immersive shell 正常。
  来源：spec requirement "Application shell SHALL render unavailable state"

## 5. i18n 资源

- [x] 5.1 在 `zh-CN.ts` 和 `en-US.ts` 的 `auth` 命名空间下新增以下 key：
  - `noWritePermission`：zh-CN "请联系管理员为您的账号添加具备 AICOService.Write 操作的角色"；en-US "Please contact your administrator to add a role with AICOService.Write operation to your account"
  - `noPermissionTitle`：zh-CN "权限不足"；en-US "Insufficient Permissions"
  - `noPermissionDescription`：zh-CN "请联系管理员为您的账号添加具备 AICOService.View 及 AICOService.Write 操作的角色"；en-US "Please contact your administrator to add a role with AICOService.View and AICOService.Write operations to your account"
  - `noPermissionSidebar`：zh-CN "权限不足，无法查看会话列表"；en-US "Insufficient permissions to view session list"
  - `slashNoWritePermission`：zh-CN "无写权限，请联系管理员添加 AICOService.Write 操作角色"；en-US "No write permission. Please contact your administrator to add a role with AICOService.Write operation"
  验证：i18n 完整性测试：zh-CN 和 en-US 均包含 `auth` 命名空间下全部 5 个 key 且文案非空。
  来源：spec requirement "All permission text SHALL be internationalized"

## 6. 清理和验证收尾

- [x] 6.1 运行前端构建验证无 TypeScript 错误。
  验证：`cd frontend/agent-web && npx tsc --noEmit`
  来源：工程约束

- [x] 6.2 运行前端单元测试，断言所有权限相关测试用例通过。
  验证：`cd frontend/agent-web && npx vitest run --reporter=verbose 2>&1 | grep -E "PASS|FAIL|auth|Auth|useUserOps|AuthGate|AuthWrapper|PermissionUnavailable"`
  来源：spec 所有 requirement

- [x] 6.3 运行 OpenSpec 严格校验。
  验证：`openspec validate agent-web-auth-control --strict`
  来源：OpenSpec 约束

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/agent-web-auth-control/spec.md`。
- 更新 `openspec/designs/architecture/agent-web-host-modes.md`：补充 `useUserOps`、`AuthGate`、`AuthWrapper` 的职责和边界说明。
- 更新 `openspec/designs/spec-to-design-map.md`：添加 `agent-web-auth-control` spec → agent-web 模块导航项。
