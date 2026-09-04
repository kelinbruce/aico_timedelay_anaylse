## Function

- **所属 Function**：`FN-10.9 Cron 工具`、`FN-8.15 管理长期记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：Agent Web 定时任务页面的写操作入口（手动创建、从会话创建、编辑、删除、执行）和记忆管理页面的写操作入口（导入、新建、编辑、置顶、发布/取消发布、归档/取消归档、删除、复制共享、取消发布共享、确认导入）在远程只读用户下被禁用并展示权限提示；只读操作保持可用。
- **依据 Requirements**：`Write operation entries SHALL be disabled when user lacks AICOService.Write`

### 结果

- **变更类型**：修改
- **目标内容**：远程只读用户在定时任务和记忆管理页面无法触发后端写操作；有 Write 权限和 local 模式行为不变。
- **依据 Requirements**：`Write operation entries SHALL be disabled when user lacks AICOService.Write`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-auth-control`
- **依据 Requirements**：`Write operation entries SHALL be disabled when user lacks AICOService.Write`