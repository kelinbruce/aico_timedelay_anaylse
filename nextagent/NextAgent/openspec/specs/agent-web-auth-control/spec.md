## Purpose

定义前端基于用户操作权限（AICOService.View / AICOService.Write）的 UI 控制能力契约，包括 useUserOps hook、AuthGate/AuthWrapper 组件、写操作入口禁用规则、空权限全应用覆盖和 L1 治理约束。
## Requirements
### Requirement: useUserOps hook SHALL provide user ops with local/remote semantics

A `useUserOps()` hook SHALL be created in `frontend/agent-web/src/features/auth/useUserOps.ts`. It SHALL read the current host context via `useContext(AppHostContext)` and return `readonly string[] | null`. Local mode SHALL return `null` (no restriction). In Immersive or PIU mode, an ops array SHALL be returned as provided, missing or `undefined` ops SHALL return `[]`, and explicit `ops: null` SHALL return `null` as the current trusted standalone-host full-access semantic. An unavailable `AppHostContext` SHALL also return `null`. The hook SHALL NOT make API calls, mutate state, or throw. This behavior means `null` is not fail-closed and is safe only when the host/provider boundary supplying it is trusted.

#### Scenario: useUserOps returns null in local mode
- **GIVEN** `AppHostContext` with `mode="local"`
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `null`

#### Scenario: useUserOps returns ops array in remote mode
- **GIVEN** `AppHostContext` with `mode="immersive"` and `site.user.ops=["AICOService.View", "AICOService.Write"]`
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `["AICOService.View", "AICOService.Write"]`

#### Scenario: useUserOps returns empty array when remote ops missing
- **GIVEN** `AppHostContext` with `mode="piu"` and `site={}` (no user object)
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `[]`

#### Scenario: Explicit null grants standalone-host semantics
- **GIVEN** `AppHostContext` with `mode="immersive"` or `mode="piu"` and `site.user.ops=null`
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `null`
- **AND** downstream AuthGate/AuthWrapper SHALL treat that value as unrestricted

#### Scenario: useUserOps returns null when AppHostContext is unavailable
- **GIVEN** `useUserOps()` is called outside `AppProviders`
- **WHEN** the hook executes
- **THEN** it SHALL return `null` (fallback to local/standalone semantics)

### Requirement: AICOServiceOperation SHALL define View and Write as string enum constants

The `AICOServiceOperation` enum SHALL define two members: `View = "AICOService.View"` and `Write = "AICOService.Write"`. These SHALL correspond to the raw string values received from `HostSiteContext.user.ops`. The enum SHALL live in `frontend/agent-web/src/features/auth/authEnums.ts`. The enum SHALL NOT include any operations beyond View and Write.

#### Scenario: Enum values match Prel site context strings
- **GIVEN** the `AICOServiceOperation` enum
- **WHEN** inspecting `AICOServiceOperation.View`
- **THEN** its value SHALL be `"AICOService.View"`
- **AND** `AICOServiceOperation.Write` SHALL be `"AICOService.Write"`

### Requirement: AuthGate SHALL disable visible write operation entries when user lacks required ops

The `AuthGate` component SHALL be created in `frontend/agent-web/src/features/auth/AuthGate.tsx`. It SHALL accept `requiredOps: AICOServiceOperation[]`, `tooltipKey?: string`, and `children: ReactNode`. It SHALL retrieve ops via `useUserOps()`. When `useUserOps()` returns `null` (local mode), it SHALL render children without modification. When the user's ops contain all `requiredOps`, it SHALL render children without modification. When the user's ops lack any required op, it SHALL render children in a disabled state and wrap them with a `Tooltip` displaying the i18n text specified by `tooltipKey`. The component SHALL NOT make API calls or mutate global state.

The disabled state SHALL be applied by injecting `disabled={true}` into Antd `Button` children via `cloneElement`, or by wrapping non-Antd elements with `pointerEvents: "none"` and visual dimming. The exact mechanism MAY vary by element type but MUST prevent user interaction.

The default `tooltipKey` SHALL be `"auth.noWritePermission"` when not provided.

#### Scenario: AuthGate renders children normally in local mode
- **GIVEN** `useUserOps()` returns `null` (local mode)
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered without `disabled` and without `Tooltip`

#### Scenario: AuthGate renders children normally when user has all required ops
- **GIVEN** `useUserOps()` returns `["AICOService.View", "AICOService.Write"]`
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered without `disabled` and without `Tooltip`

#### Scenario: AuthGate disables children when user lacks required ops
- **GIVEN** `useUserOps()` returns `["AICOService.View"]`
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered in a disabled state
- **AND** a `Tooltip` SHALL be present with i18n text from `auth.noWritePermission`

#### Scenario: AuthGate disables children when user has no ops
- **GIVEN** `useUserOps()` returns `[]`
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered in a disabled state
- **AND** a `Tooltip` SHALL be present

### Requirement: AuthWrapper SHALL conditionally render children based on required ops

The `AuthWrapper` component SHALL be created in `frontend/agent-web/src/features/auth/AuthWrapper.tsx`. It SHALL accept `requiredOps: AICOServiceOperation[]`, `fallback?: ReactNode`, and `children: ReactNode`. It SHALL retrieve ops via `useUserOps()`. When `useUserOps()` returns `null` (local mode), it SHALL render children. When the user's ops contain all `requiredOps`, it SHALL render children. When the user's ops lack any required op, it SHALL render `fallback` if provided, or `null` if not.

#### Scenario: AuthWrapper renders children in local mode
- **GIVEN** `useUserOps()` returns `null`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered

#### Scenario: AuthWrapper renders children when user has all required ops
- **GIVEN** `useUserOps()` returns `["AICOService.View", "AICOService.Write"]`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered

#### Scenario: AuthWrapper returns null when user lacks required ops and no fallback
- **GIVEN** `useUserOps()` returns `["AICOService.View"]`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** the component SHALL render `null`

#### Scenario: AuthWrapper renders fallback when provided
- **GIVEN** `useUserOps()` returns `["AICOService.View"]`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}` and `fallback={<Placeholder />}`
- **THEN** the component SHALL render `<Placeholder />`

### Requirement: ChatPage SHALL read userOps via useUserOps hook with semantic equivalence

`ChatPage.tsx` SHALL use `useUserOps()` rather than owning a second host-ops parser. Local mode and explicit remote `ops:null` return `null`; remote mode with an array returns that array; remote mode with missing or `undefined` ops returns `[]`. The `userOps` value passed to `ShareSettingsModal` SHALL preserve those current semantics.

#### Scenario: ChatPage userOps is null in local mode
- **GIVEN** `AppHostContext` with `mode="local"`
- **WHEN** `ChatPageCore` renders
- **THEN** `useUserOps()` SHALL return `null`
- **AND** `ShareSettingsModal` SHALL receive `userOps={null}`

#### Scenario: ChatPage userOps returns ops in remote mode
- **GIVEN** `AppHostContext` with `mode="immersive"` and `site.user.ops=["AICOService.View", "AICOService.Write"]`
- **WHEN** `ChatPageCore` renders
- **THEN** `useUserOps()` SHALL return `["AICOService.View", "AICOService.Write"]`
- **AND** `ShareSettingsModal` SHALL receive the same ops array

### Requirement: Write operation entries SHALL be disabled when user lacks AICOService.Write

Within the currently gated `MessageInput`, Sidebar, turn-action, suggested-question, CronTaskDashboardPage, and MemoryManagePage surfaces, the following write operation UI elements MUST require `AICOServiceOperation.Write`. When a remote user lacks that operation, visible controls SHALL be disabled with the existing permission explanation and hidden write-only inputs SHALL not be rendered. This requirement does not claim that the Immersive RIGHT header/search or PIU header has already adopted the same gate.

1. The Composer textarea and send button in `MessageInput` SHALL be disabled.
2. Edit confirm and cancel controls SHALL be disabled.
3. While a request is executing, the stop control that replaces the send control SHALL be disabled.
4. The attachment button SHALL be disabled, the hidden file input SHALL not be rendered, and file drag-and-drop SHALL be ignored.
5. The more-menu reload action SHALL be disabled.
6. Slash-command catalog entries `/retry` and `/edit` SHALL be disabled with a permission-related reason; the `/help` catalog entry SHALL remain enabled, while actual Slash submission remains subject to the disabled Composer submit path.
7. Sidebar new-session, session-rename, and session-delete controls SHALL be disabled.
8. Turn retry, user-message edit, like, dislike, favorite, fork, share, and pin-question controls SHALL be disabled.
9. Suggested-question items whose click submits a request SHALL not be actionable.
10. CronTaskDashboardPage manual-create and create-from-session buttons SHALL be disabled.
11. CronTaskDashboardPage task-card edit, delete, and execute controls SHALL be disabled.
12. MemoryManagePage import button SHALL be disabled.
13. MemoryManagePage create-memory button SHALL be disabled.
14. MemoryManagePage detail-panel edit, pin, publish/unpublish, archive/unarchive, and delete controls SHALL be disabled.
15. MemoryManagePage shared-detail copy-to-mine and unpublish controls SHALL be disabled.
16. MemoryManagePage import-confirm button in the import preview modal SHALL be disabled.

Read-only operations SHALL remain available when the user has View but not Write, including session browsing and switching, history and favorite browsing, message and conversation-preview reading, Run Graph viewing, recommendation display, copy, theme and locale switching, sidebar layout controls, shortcut help opened through the global help shortcut, cron task list and execution history browsing, memory list and detail viewing, and memory export and template download. This requirement SHALL NOT claim that `/help` can be submitted through a disabled Composer.

#### Scenario: Composer is disabled without Write permission
- **GIVEN** a remote user has `AICOService.View` but lacks `AICOService.Write`
- **WHEN** `MessageInput` renders in idle state
- **THEN** the Composer textarea and send control SHALL be present but disabled

#### Scenario: Stop replaces send and is disabled without Write permission
- **GIVEN** a remote user lacks `AICOService.Write` and a request is executing
- **WHEN** `MessageInput` renders its primary action
- **THEN** the stop control SHALL replace the send control
- **AND** the stop control SHALL be disabled

#### Scenario: Attachment intake is disabled without Write permission
- **GIVEN** a remote user lacks `AICOService.Write`
- **WHEN** `MessageInput` renders or receives a file drop
- **THEN** the attachment button SHALL be disabled
- **AND** the hidden file input SHALL not be rendered
- **AND** the dropped file SHALL not enter the attachment queue

#### Scenario: Implemented slash commands reflect Write permission
- **GIVEN** a remote user lacks `AICOService.Write`
- **WHEN** the slash-command catalog is shown
- **THEN** `/retry` and `/edit` SHALL be disabled with a permission-related reason
- **AND** the `/help` catalog entry SHALL remain enabled
- **AND** this catalog state SHALL NOT imply that `/help` bypasses the disabled Composer submit guard
- **AND** no `/clear` command SHALL be required by this permission contract

#### Scenario: Session and turn write actions are disabled
- **GIVEN** a remote user lacks `AICOService.Write`
- **WHEN** session and turn actions are rendered
- **THEN** new session, rename, delete, retry, edit, like, dislike, favorite, fork, share, pin-question, and submit-triggering suggestion actions SHALL be disabled

#### Scenario: Current gated write controls are available with Write permission
- **GIVEN** a remote user has both `AICOService.View` and `AICOService.Write`
- **WHEN** Agent Web renders the gated controls listed by this requirement in otherwise eligible states
- **THEN** those controls SHALL not be disabled by the permission gate
- **AND** `/help`, `/retry`, and `/edit` SHALL reflect their non-permission eligibility conditions

#### Scenario: Ungated host-specific entries are outside this guarantee
- **WHEN** the Immersive RIGHT header/search or PIU header renders its current host-specific session actions
- **THEN** this requirement SHALL NOT claim that those entries enforce the same Write gate

#### Scenario: 定时任务页面写操作在缺少 Write 时禁用
- **GIVEN** 远程只读用户拥有 `AICOService.View` 但缺少 `AICOService.Write`
- **WHEN** 定时任务页面渲染
- **THEN** 手动创建任务按钮 MUST 被禁用
- **AND** 从会话创建任务按钮 MUST 被禁用
- **AND** 任务卡片的编辑、删除和执行控件 MUST 被禁用
- **AND** 禁用控件 MUST 展示权限提示

#### Scenario: 定时任务页面写操作在有 Write 时可用
- **GIVEN** 远程用户拥有 `AICOService.View` 和 `AICOService.Write`
- **WHEN** 定时任务页面渲染
- **THEN** 手动创建、从会话创建、编辑、删除和执行控件 SHALL 不被权限门禁禁用
- **AND** 既有业务禁用条件（`actionLoading`、任务状态等）MUST 继续优先于权限门禁

#### Scenario: 定时任务页面只读操作不受权限影响
- **GIVEN** 远程只读用户拥有 `AICOService.View` 但缺少 `AICOService.Write`
- **WHEN** 定时任务页面渲染
- **THEN** 任务列表浏览、执行记录列表浏览和查看执行详情 SHALL 保持可用
- **AND** 执行记录列表加载失败后的重试按钮 SHALL 保持可用

#### Scenario: 记忆管理页面写操作在缺少 Write 时禁用
- **GIVEN** 远程只读用户拥有 `AICOService.View` 但缺少 `AICOService.Write`
- **WHEN** 记忆管理页面渲染
- **THEN** 导入记忆按钮 MUST 被禁用
- **AND** 新建记忆按钮 MUST 被禁用
- **AND** 详情面板的编辑、置顶、发布/取消发布、归档/取消归档和删除控件 MUST 被禁用
- **AND** 共享详情面板的复制到我的和取消发布控件 MUST 被禁用
- **AND** 导入预览弹窗的确认导入按钮 MUST 被禁用
- **AND** 禁用控件 MUST 展示权限提示

#### Scenario: 记忆管理页面写操作在有 Write 时可用
- **GIVEN** 远程用户拥有 `AICOService.View` 和 `AICOService.Write`
- **WHEN** 记忆管理页面渲染
- **THEN** 导入、新建、编辑、置顶、发布/取消发布、归档/取消归档、删除、复制共享和确认导入控件 SHALL 不被权限门禁禁用
- **AND** 既有业务禁用条件（`actionLoading`、表单校验等）MUST 继续优先于权限门禁

#### Scenario: 记忆管理页面只读操作不受权限影响
- **GIVEN** 远程只读用户拥有 `AICOService.View` 但缺少 `AICOService.Write`
- **WHEN** 记忆管理页面渲染
- **THEN** 记忆列表浏览、详情查看、导出和下载模板 SHALL 保持可用

### Requirement: Application shell SHALL render unavailable state when user lacks both View and Write

When `useUserOps()` returns `[]` (remote mode, no permissions), the entire application content area SHALL render a `PermissionUnavailable` component, covering all routes including chat session pages and shared conversation pages. The `PermissionUnavailable` component SHALL display a title and description using i18n keys `auth.noPermissionTitle` and `auth.noPermissionDescription`. The sidebar, chat composer dock, shared conversation page, and PIU panel SHALL NOT render. The permission check SHALL be performed at the shell level (`ImmersiveApp` and `AIAgentPiuRuntime`), not inside individual route components.

#### Scenario: Main content renders unavailable state when user has no permissions
- **GIVEN** a user with ops `[]`
- **WHEN** rendering the application in remote mode
- **THEN** the entire application content area SHALL render the `PermissionUnavailable` component
- **AND** the chat composer dock SHALL NOT be present
- **AND** the shared conversation page SHALL NOT be present
- **AND** the immersive shell SHALL NOT be present
- **AND** the PIU panel SHALL NOT be present

#### Scenario: Local mode never renders unavailable state
- **GIVEN** `useUserOps()` returns `null` (local mode)
- **WHEN** rendering the application
- **THEN** the `PermissionUnavailable` component SHALL NOT be rendered
- **AND** the immersive shell with chat composer SHALL be present
- **AND** shared conversation pages SHALL be accessible

### Requirement: All permission提示文案 SHALL be internationalized

All user-visible permission control text SHALL be defined in i18n resource files (`zh-CN.ts` and `en-US.ts`) under the `auth` namespace. The following keys SHALL be defined in both locales:
- `auth.noWritePermission`: Tooltip text for disabled write operations, instructing the user to contact their administrator to add a role with `AICOService.Write` operation.
- `auth.noPermissionTitle`: Title for the full-page unavailable state.
- `auth.noPermissionDescription`: Description for the full-page unavailable state, instructing the user to contact their administrator to add a role with both `AICOService.View` and `AICOService.Write` operations.
- `auth.noPermissionSidebar`: Message displayed in the sidebar session list area when the user has no permissions.
- `auth.slashNoWritePermission`: `disabledReason` text for slash commands (`/retry`, `/edit`, `/clear`) when the user lacks Write permission.

#### Scenario: zh-CN contains all auth i18n keys
- **GIVEN** the zh-CN i18n resource file
- **WHEN** inspecting the `auth` namespace
- **THEN** `noWritePermission`, `noPermissionTitle`, `noPermissionDescription`, `noPermissionSidebar`, and `slashNoWritePermission` SHALL all be present with non-empty Chinese text

#### Scenario: en-US contains all auth i18n keys
- **GIVEN** the en-US i18n resource file
- **WHEN** inspecting the `auth` namespace
- **THEN** `noWritePermission`, `noPermissionTitle`, `noPermissionDescription`, `noPermissionSidebar`, and `slashNoWritePermission` SHALL all be present with non-empty English text

### Requirement: New write operation UI entries SHALL use AuthGate or AuthWrapper for permission control
When adding new UI entries that trigger backend write operations (POST/PUT/DELETE/PATCH) or initiate submit/retry/edit/cancel/annotation flows, developers SHALL wrap them with `AuthGate` (for visible entries that should be disabled with a tooltip) or `AuthWrapper` (for hidden entries that should not be rendered). This is a governance guideline enforced through code review, not through automated architecture tests or lint rules. Write operations are defined as any UI action that directly or indirectly calls `requestService`, `sessionService.renameSession`, `sessionService.createSession`, `annotationService.upsertAnnotation`, or `apiClient.post/put/delete/patch`.

#### Scenario: Code review checks for AuthGate usage on new write entries
- **WHEN** a new UI entry that triggers a backend write operation is added
- **THEN** the code review SHALL verify that the entry is wrapped with `AuthGate` or `AuthWrapper`
- **AND** if the entry is not wrapped, the reviewer SHALL request the change
