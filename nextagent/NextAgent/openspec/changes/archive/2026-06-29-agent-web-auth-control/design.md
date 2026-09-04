## 背景和现状（Context）

NextAgent 前端（`frontend/agent-web`）支持三种宿主模式（local、immersive、PIU），通过 Prel 框架注入 `HostSiteContext`。该 context 包含 `user.ops`（`readonly string[]`），承载当前用户的操作权限。

现有代码中，`AppHostContext`（`React.Context<AppHostContextValue | null>`）已在 `AppProviders` 中创建，向组件树传播 `mode`、`site`、`theme`、`locale` 等。`ChatPage.tsx` 已通过 `useContext(AppHostContext)` 手写 `isRemoteMode ? (host?.site?.user?.ops ?? null) : null` 读取 ops，并传给 `ShareSettingsModal`。`SharedConversationPage.tsx` 也以类似方式读取 ops 传给 `shareService`。但没有任何 UI 入口基于 ops 做权限控制。

产品需要支持 `AICOService.View`（只读）和 `AICOService.Write`（读写）两种操作权限。远端模式（immersive、PIU）下 ops 最差为空数组 `[]`（表示无任何权限），不会为 `null`。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 新增 `useUserOps()` hook，复用 `AppHostContext` 读取 ops，封装 local/remote 语义。
- 新增 `AuthGate` 组件，对可见写操作入口做禁用 + Tooltip 提示。
- 新增 `AuthWrapper` 组件，对隐藏元素做条件渲染。
- 新增 `AICOServiceOperation` 枚举，定义 View 和 Write 常量。
- 用 `AuthGate` 禁用所有写操作入口（发送、编辑、重试、取消、停止、附件上传、新建会话、重命名会话、标注、推荐问题提交触发、slash 写命令）。
- 在 ops 为空数组时渲染全页无权限提示。
- `ChatPage.tsx` 的 ops 读取替换为 `useUserOps()`，语义完全等价。
- 所有权限提示文案走 i18n（zh-CN / en-US）。
- 在 spec 中建立治理 requirement，指导未来新增写操作入口考虑权限控制。

**非目标：**
- 不修改后端 API、stream event、runtime lifecycle 或 gateway persistence。
- 不修改 `HostSiteContext` 的定义或 Prel 注入方式。
- 不修改 local 模式的行为。
- 不修改 `ShareSettingsModal`、`ShareModeBar`、`shareService` 的现有 ops 消费方式。
- 不实现基于角色（roles）的权限控制。
- 不引入架构测试或 lint 规则的强制约束。
- 不引入运行时写操作 gate（写服务调用中间层）。

## 设计决策（Decisions）

### D1：复用 AppHostContext，新增 useUserOps hook

**选择：** 不新建独立的 `HostOpsContext`。在 `src/features/auth/useUserOps.ts` 中创建 `useUserOps()` hook，内部通过 `useContext(AppHostContext)` 读取 `mode` 和 `site.user.ops`，封装 local/remote 语义：

```typescript
function useUserOps(): readonly string[] | null {
  const host = useContext(AppHostContext);
  const isRemoteMode = host?.mode === "immersive" || host?.mode === "piu";
  return isRemoteMode ? (host?.site?.user?.ops ?? []) : null;
}
```

返回值语义：
- `null` → local 模式，不限制（全放行）。
- `[]` → remote 模式，ops 缺失或为空，安全降级（无权限）。
- `[...]` → remote 模式，有 ops，按 requiredOps 判断。

**弃用方案：** 新建独立 `HostOpsContext`（`React.Context<readonly string[]>`）。该方案与现有 `AppHostContext` 并行传播 site 信息，导致两个 Context 表达同一数据源，增加维护负担。且 `ChatPage.tsx` 已通过 `AppHostContext` 读取 ops，新建 Context 需要同步迁移现有消费方，违反"同形同策"原则。

### D2：ChatPage ops 读取语义等价替换

**选择：** `ChatPage.tsx` 现有代码：
```typescript
const isRemoteMode = host?.mode === "immersive" || host?.mode === "piu";
const userOps = isRemoteMode ? (host?.site?.user?.ops ?? null) : null;
```
替换为：
```typescript
const userOps = useUserOps();
```

两者在三种输入下的返回值完全一致：
- local 模式：`null`（不变）。
- remote + ops 存在：`[...]`（不变）。
- remote + ops 缺失：`null` → `[]`。

**差异说明：** remote + ops 缺失时，现有代码返回 `null`，hook 返回 `[]`。但产品确认远端模式 ops 最差为 `[]`，不会为 `null`（`host?.site?.user?.ops ?? null` 中的 `?? null` 是防御性 fallback，实际不会触发）。因此 `?? null` 和 `?? []` 在实际运行中行为一致。hook 使用 `?? []` 是为了让 `AuthGate`/`AuthWrapper` 的空权限判断更直白（`[]` 表示"remote 无权限"，`null` 专属"local 放行"），避免 `null` 歧义。

`ChatPage.tsx` 将 `userOps` 传给 `ShareSettingsModal` 的 prop 维持不变，不影响 share 功能行为（`ShareSettingsModal` 接收 `readonly string[] | null`，`[]` 和 `null` 在其逻辑中都走"不传 allowedOps"分支）。

### D3：AuthGate 采用禁用 + Tooltip，而非隐藏

**选择：** 对所有可见写操作入口，保持元素可见但 `disabled`，并通过 `Tooltip` 提示用户无写权限及如何获取权限。`AuthGate` 是一个包裹组件：

```typescript
interface AuthGateProps {
  requiredOps: AICOServiceOperation[];
  tooltipKey?: string;  // i18n key for tooltip text
  children: ReactNode;
}
```

`AuthGate` 内部通过 `useUserOps()` 判断：
- `null`（local）→ 渲染 children，不禁用。
- ops 包含所有 requiredOps → 渲染 children，不禁用。
- ops 缺少任意 requiredOp → 渲染 children 但设为 disabled 状态，外层包裹 `Tooltip`。

**禁用实现方式按元素类型区分：**
- Antd `Button`：`AuthGate` 通过 React.cloneElement 注入 `disabled={true}`。
- Antd `Dropdown` 触发器：包裹层 `pointerEvents: "none"` + 视觉灰显 + `Tooltip`。
- Menu item：注入 `disabled: true`。
- 自定义 `<button>`：包裹层 `pointerEvents: "none"` + `opacity` 灰显 + `Tooltip`。

**Tooltip 文案（i18n）：**
- 无 Write 权限：`auth.noWritePermission` → "请联系管理员为您的账号添加具备 AICOService.Write 操作的角色" / "Please contact your administrator to add a role with AICOService.Write operation to your account"

**弃用方案：** 隐藏写操作入口（`display: none` 或不渲染）。隐藏后用户不知道功能存在，无法了解产品能力，也不清楚自己缺少什么权限。禁用 + Tooltip 让用户看到功能入口并理解权限不足的原因，体验更友好。

### D4：AuthWrapper 用于无视觉表现的隐藏元素

**选择：** 对于不需要用户可见的隐藏元素（如 `<input type="file">`），使用 `AuthWrapper` 做条件渲染：

```typescript
interface AuthWrapperProps {
  requiredOps: AICOServiceOperation[];
  fallback?: ReactNode;
  children: ReactNode;
}

function AuthWrapper({ requiredOps, fallback, children }) {
  const ops = useUserOps();
  if (ops === null) return children;        // local 放行
  const hasAllOps = requiredOps.every(op => ops.includes(op));
  return hasAllOps ? children : (fallback ?? null);
}
```

本 change 中 `AuthWrapper` 用于隐藏 file input（无 Write 时不渲染，避免 `attach-button` click 触发文件选择对话框）。

### D5：空权限全应用覆盖

**选择：** 当 `useUserOps()` 返回 `[]`（remote 模式无任何权限）时，整个应用内容区渲染 `PermissionUnavailable` 组件，覆盖所有路由。权限检查在 shell 层级执行：`ImmersiveApp` 提取 `ImmersiveContent` 内部组件调用 `useUserOps()`，空权限时直接返回 `PermissionUnavailable`，不渲染任何路由（包括 `/shared/:shareId`）；`AIAgentPiuRuntime` 提取 `PiuContent` 内部组件做同样判断。`ChatPage` 内部不再做空权限判断，避免只覆盖对话面板而遗漏 share 路由和 PIU 面板。

`PermissionUnavailable` 文案（i18n）：
- `auth.noPermissionTitle` → "权限不足" / "Insufficient Permissions"
- `auth.noPermissionDescription` → "请联系管理员为您的账号添加具备 AICOService.View 及 AICOService.Write 操作的角色" / "Please contact your administrator to add a role with AICOService.View and AICOService.Write operations to your account"

### D6：写操作入口完整清单

写操作定义：任何触发后端 POST/PUT/DELETE/PATCH 调用，或直接发起上述调用的 UI 入口（包括 slash 命令和推荐问题点击触发的 submit 链路）。

| 区域 | 操作 | testid / 选择器 | 控制方式 |
|------|------|-----------------|----------|
| MessageInput | 发送消息 | `btn-send` | AuthGate disabled + Tooltip |
| | 编辑确认 | `btn-confirm-edit` | AuthGate disabled + Tooltip |
| | 取消编辑 | `btn-cancel-edit` | AuthGate disabled + Tooltip |
| | 停止生成 | `btn-stop` | AuthGate disabled + Tooltip |
| | 附件上传按钮 | `attach-button` | AuthGate disabled + Tooltip |
| | 隐藏 file input | `type="file"` | AuthWrapper 不渲染 |
| | 拖放区 | `attachment-drop-hint` | 禁用 onDrop/onDragOver |
| | 更多菜单 reload | `btn-more-menu` | menu item disabled |
| | slash /retry | slash-command-panel | command disabled + disabledReason |
| | slash /edit | slash-command-panel | command disabled + disabledReason |
| | slash /clear | slash-command-panel | command disabled + disabledReason |
| Sidebar | 新建会话 | `sidebar-new-session-shortcut` | AuthGate disabled + Tooltip |
| | 重命名会话 | menu key="rename" | menu item disabled |
| TurnBlock | 重试 | `btn-retry-ai` | AuthGate disabled + Tooltip |
| | 编辑 | `btn-edit-user` | AuthGate disabled + Tooltip |
| | 点赞 | `annotation-like` | AuthGate disabled + Tooltip |
| | 踩 | `annotation-dislike` | AuthGate disabled + Tooltip |
| | 收藏 | `annotation-favorite` | AuthGate disabled + Tooltip |
| SuggestedQuestions | 推荐问题点击 | `suggested-question-item` | AuthGate disabled + Tooltip |

读操作（不限制）：会话列表浏览、会话切换、历史搜索、收藏列表浏览、消息列表查看、对话预览导航、run graph 面板、推荐问题列表展示、技能列表展示、复制消息内容、主题/语言切换、sidebar 折叠展开、帮助。

### D7：slash 命令权限控制复用现有 disabled 机制

**选择：** `commandCatalog.ts` 已有 `isEnabled(context)` + `disabledReason` 机制。在 `ComposerCommandContext` 中新增 `hasWritePermission: boolean` 字段，将 `/retry`、`/edit`、`/clear` 的 `isEnabled` 判断扩展为同时检查 `hasWritePermission`。无 Write 时这三个命令的 `disabledReason` 显示权限提示文案。

`/help` 不受影响（它是读操作，只打开帮助面板）。

### D8：治理约束为 L1 spec requirement

**选择：** 在 spec 中新增治理 requirement："新增写操作 UI 入口 SHOULD 使用 `AuthGate` 或 `AuthWrapper` 做权限控制"。这是 L1 层级的治理约束，依赖开发者遵守和 code review 检查，不引入架构测试或 lint 规则的强制约束。

**弃用方案：**
- L2 架构测试（dependency-cruiser 规则：组件 import 写服务则必须 import auth 模块）：约束力更强，但需要维护写服务注册表和误报处理，当前阶段不引入。
- L3 运行时 gate（写服务调用经过统一权限检查中间层）：最强制，但需要改造所有写服务调用路径，改动面过大，收益递减。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | ops 来自 Prel 注入的可信 `HostSiteContext`，`useUserOps` 只读不写；`AuthGate`/`AuthWrapper` 不做 API 调用，不改变全局状态。权限控制是客户端 UI 层，后端 API 已有独立的 auth/owner scope 校验。 | code review |
| 性能/容量 | `useUserOps` 仅做 Context 读取 + 数组判断，无异步操作。`AuthGate` 的 `every` 遍历最多 2 个元素。 | — |
| 可靠性/恢复 | `useUserOps` 在 `AppHostContext` 为 null 时返回 `null`（local 语义，安全放行）；remote 缺失 ops 时返回 `[]`（安全降级到无权限）。 | unit tests |
| 可维护性 | 写操作入口由 `AuthGate` 包裹，新增受控入口只需加一层 wrapper。治理 requirement 指导未来新增入口。 | code review |
| 可测试性 | `useUserOps`、`AuthGate`、`AuthWrapper` 都是纯函数式组件/hook，可在测试中提供 mock context 验证行为。 | unit/component tests |
| 审计/可追溯性 | 权限检查发生在客户端渲染阶段，不产生 trace 或 audit 事件（不涉及后端审计）。 | — |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| useUserOps 返回 null in local mode | 1.2 | useUserOps unit tests |
| useUserOps 返回 ops array in remote mode | 1.2 | useUserOps unit tests |
| useUserOps 返回 [] when remote ops missing | 1.2 | useUserOps unit tests |
| ChatPage userOps 语义等价替换 | 1.5 | ChatPage 语义等价测试 |
| AuthGate local 放行 | 1.3 | AuthGate unit tests |
| AuthGate 有权限放行 | 1.3 | AuthGate unit tests |
| AuthGate 无权限 disabled + Tooltip | 1.3 | AuthGate unit tests |
| AuthWrapper local 放行 | 1.4 | AuthWrapper unit tests |
| AuthWrapper 无权限 null | 1.4 | AuthWrapper unit tests |
| btn-send disabled without Write | 2.1 | MessageInput component tests |
| message-textarea 仍可用 | 2.1 | MessageInput component tests |
| attach-button disabled | 2.1 | MessageInput component tests |
| file input 不渲染 | 2.1 | MessageInput component tests |
| 拖放区禁用 | 2.1 | MessageInput component tests |
| slash 写命令 disabled | 2.2 | MessageInput component tests |
| 新建会话 disabled | 2.3 | Sidebar component tests |
| 重命名 disabled | 2.3 | Sidebar component tests |
| 重试/编辑/标注 disabled | 2.4 | TurnBlock component tests |
| 推荐问题点击禁用 | 2.5 | SuggestedQuestions component tests |
| 空权限全页提示 | 3.1 | PermissionUnavailable tests |
| i18n 完整性 | 3.2 | i18n tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-auth-control/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/agent-web-host-modes.md`（归档前补充 `useUserOps`、`AuthGate`、`AuthWrapper` 的职责和边界说明）
- 模块设计：无（属前端内部能力，不产生跨模块契约）
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`（归档前添加 `agent-web-auth-control` 导航项）

## 风险与取舍（Risks / Trade-offs）

- [取舍] 权限检查完全在客户端完成，依赖 Prel 注入的 ops 可信度。后端 API 已有独立的 auth/owner scope 校验，前端权限控制是 UX 层增强，不是安全边界。
- [风险] 未来新增写操作入口时可能忘记用 `AuthGate`/`AuthWrapper` 包裹。 -> 缓解：spec 治理 requirement + code review 检查。当前不引入架构测试强制约束，如未来出现漏控事故可升级到 L2。
- [风险] `AuthGate` 通过 `cloneElement` 注入 `disabled` 可能与某些组件的现有 `disabled` prop 冲突。 -> 缓解：`AuthGate` 只在需要禁用时注入 `disabled`，有权限时不干预 children props。
- [取舍] slash 命令权限控制扩展了 `ComposerCommandContext`，改变了 command catalog 的接口。但这是复用现有 disabled 机制的最自然方式，避免另建平行权限判断。

## 迁移计划（Migration Plan）

无。本 change 新增能力，不改变现有行为。local 模式和有完整权限的 remote 用户行为不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-auth-control/spec.md`：新增稳定行为契约。
- `openspec/designs/architecture/agent-web-host-modes.md`：补充 `useUserOps`、`AuthGate`、`AuthWrapper` 的职责和边界说明。
- `openspec/designs/spec-to-design-map.md`：添加 `agent-web-auth-control` spec → agent-web 模块导航项。

## 待确认问题（Open Questions）

无。
