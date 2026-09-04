# agent-web-cron-task-dashboard Specification

## Purpose
定义 agent-web 中 Cron 任务看板的导航、查询投影和用户可见操作契约，使用户可以在不接触 runtime 内部状态的前提下查看和管理任务。

## Function

- **所属 Function**：`FN-10.9 Cron 工具`
## Requirements
### Requirement: Cron task dashboard navigation
系统 SHALL 在 `frontend/agent-web` 的左侧 sidebar 新建会话入口下方提供定时任务入口。用户点击该入口时，前端 MUST 跳转到 Cron task dashboard route，并且该跳转 MUST 只改变浏览器 route/view state，不得创建、加载、重命名或删除 chat session，也不得修改 canonical conversation truth。

#### Scenario: Sidebar entry navigates to dashboard
- **WHEN** 用户点击 sidebar 中的定时任务入口
- **THEN** 前端 MUST 导航到 Cron task dashboard route
- **AND** sidebar MUST 将该入口标记为当前 active navigation item
- **AND** 最近会话列表和收藏列表的持久化数据 MUST NOT 因该导航被修改

### Requirement: Cron task dashboard manages task mutations
Cron task dashboard SHALL 支持用户通过表单创建 Cron task、编辑 active task 的 `cron`、`prompt`、`recurring`，并删除 task。前端 MUST 在提交前要求 `cron` 和 `prompt` 非空；后端 validation、not found 和 inactive update 错误 MUST 呈现给用户。成功 mutation 后，页面 MUST 刷新 task 卡片列表，并保持选中 task 与后端返回结果一致。

#### Scenario: User creates a Cron task
- **WHEN** 用户在 dashboard 中提交合法 `cron`、非空 `prompt` 和 `recurring`
- **THEN** 前端 MUST 调用 `POST /api/v1/cron-tasks`
- **AND** 成功后 MUST 刷新列表并显示新建 task

#### Scenario: User updates an active Cron task
- **WHEN** 用户编辑已选 active task 的 `cron`、`prompt` 或 `recurring`
- **THEN** 前端 MUST 调用 `PUT /api/v1/cron-tasks/:taskId`
- **AND** 成功后 MUST 使用后端返回的 task view 更新详情和列表

#### Scenario: User deletes a Cron task
- **WHEN** 用户在 task 卡片上展开更多操作菜单并点击“删除”后确认
- **THEN** 前端 MUST 调用 `DELETE /api/v1/cron-tasks/:taskId`
- **AND** 成功后 MUST 刷新 task 卡片列表
- **AND** 若被删除 task 是当前选中 task，页面 MUST 清理该 task 的执行记录详情

#### Scenario: User opens execution records from a task card
- **WHEN** 用户在 task 卡片上点击“执行”
- **THEN** 前端 MUST 调用 `POST /api/v1/cron-tasks/:taskId/runs` 触发该 task 一次即时执行
- **AND** 该请求 MUST NOT 携带 owner、agent、session、run 或 prompt override 字段
- **AND** 后端 MUST 在 trusted owner 与 active Agent scope 下 claim 当前时间的 Cron trigger，并复用已有 Cron trigger delivery/runtime 路径提交运行
- **AND** 前端 MUST 选择该 task、切换到“执行记录” Tab，并刷新该 task 的 execution records

### Requirement: Cron task dashboard displays execution records
Cron task dashboard SHALL 在“执行记录” Tab 为选中 task 提供 execution record 查看区域。该区域 MUST 使用 `GET /api/v1/cron-tasks/:taskId/runs`。执行记录 MUST 支持按时间日期段和定时任务名称筛选。执行记录区域左侧 MUST 提供按 execution `scheduledAt` 日期聚合的时间线，按天展示执行过的 task 和执行次数。执行记录 MUST 按单列行式记录卡片展示，每行 MUST 展示定时任务卡片标题、执行时间和执行结果摘要，并提供“查看详情”操作；执行时间 MUST 位于记录 header 右侧，执行结果摘要 MUST 位于记录 content 区域。详情默认 MUST 收起；用户展开详情后，页面 MUST 展示 trigger 状态、run 状态、terminal commit state、sessionId、requestRunId 和 safe terminal result content。状态字段 MUST 带明确标签。页面 MUST NOT 在本 change 中定义或执行 Cron result session 跳转策略；若显示 `sessionId`，它只作为只读定位信息。

#### Scenario: User views task executions
- **WHEN** 用户选中一条 task
- **THEN** 页面 MUST 加载该 task 的 execution records
- **AND** 页面 MUST 在执行记录左侧按天展示该 task 的执行时间线
- **AND** 页面 MUST 以行式记录卡片展示定时任务卡片标题、右侧执行时间和 content 区域内的执行结果摘要
- **AND** 用户 MUST 能通过“查看详情”展开完整状态和结果内容
- **AND** 页面 MUST 显示空态、加载态和错误态
- **AND** 页面 MUST NOT 自动打开 execution 对应 chat session

#### Scenario: User filters task executions
- **WHEN** 用户在执行记录 Tab 输入定时任务名称或选择开始/结束日期
- **THEN** 页面 MUST 按已加载 task 的定时任务标题/ID 和 execution `scheduledAt` 日期段过滤记录
- **AND** 页面 MUST NOT 向 `/runs` API 发送 owner、agent、session、run 或未定义筛选字段

### Requirement: Cron task dashboard displays explicit target binding

Cron task dashboard MUST display the explicit target binding returned by Cron task management API. A task with `target.kind="SKILL"` MUST be visibly identified as a Skill task and show `target.name`. A task with `target.kind="WORKFLOW"` MUST be visibly identified as a Workflow task and show `target.name`. A task without target MUST be visibly identified as a prompt-only scheduled task or show no target badge; both outcomes are compliant only if the task content remains visible and no false Skill or Workflow binding is shown.

#### Scenario: Dashboard renders Skill target
- **WHEN** the task list API returns a Cron task with `target.kind="SKILL"` and `target.name="alarm-diagnosis"`
- **THEN** the task card MUST show a Skill target indicator containing `alarm-diagnosis`
- **AND** the card MUST continue to show the task prompt, schedule, frequency, next run and actions

#### Scenario: Dashboard renders Workflow target
- **WHEN** the task list API returns a Cron task with `target.kind="WORKFLOW"` and `target.name="ran-alarm-diagnosis"`
- **THEN** the task card MUST show a Workflow target indicator containing `ran-alarm-diagnosis`
- **AND** the card MUST continue to show the task prompt, schedule, frequency, next run and actions

#### Scenario: Dashboard does not infer target from prompt text
- **WHEN** the task list API returns a Cron task without `target`
- **THEN** the dashboard MUST NOT display a Skill or Workflow target badge by parsing `$skill:` or `$workflow:` from the prompt
- **AND** execution behavior shown by the dashboard MUST remain based on the API returned target field

### Requirement: Cron task dashboard manages explicit target binding

Cron task dashboard create and edit forms MUST allow the user to choose one of exactly three target modes: prompt-only, Skill, or Workflow. Prompt-only mode MUST submit no target. Skill mode MUST submit `target.kind="SKILL"` and a user-selected or user-entered Skill name. Workflow mode MUST submit `target.kind="WORKFLOW"` and a user-entered Workflow name. The form MUST require a non-empty target name before submitting Skill or Workflow mode.

#### Scenario: User creates prompt-only Cron task
- **WHEN** the user submits the create form with target mode prompt-only
- **THEN** frontend MUST call `POST /api/v1/cron-tasks` without a `target` field
- **AND** frontend MUST still send valid `cron`, `prompt` and `recurring`

#### Scenario: User creates Skill-bound Cron task
- **WHEN** the user submits the create form with target mode Skill and name `alarm-diagnosis`
- **THEN** frontend MUST call `POST /api/v1/cron-tasks` with `target.kind="SKILL"` and `target.name="alarm-diagnosis"`
- **AND** frontend MUST NOT embed `$skill:alarm-diagnosis` into `prompt`
- **AND** frontend MUST NOT send `routingConstraints.targetSkill`

#### Scenario: User creates Workflow-bound Cron task
- **WHEN** the user submits the create form with target mode Workflow and name `ran-alarm-diagnosis`
- **THEN** frontend MUST call `POST /api/v1/cron-tasks` with `target.kind="WORKFLOW"` and `target.name="ran-alarm-diagnosis"`
- **AND** frontend MUST NOT embed `$workflow:ran-alarm-diagnosis` into `prompt`
- **AND** frontend MUST NOT send `routingConstraints.targetRecipe`

#### Scenario: User edits existing target
- **WHEN** the user edits an existing Cron task whose response contains target
- **THEN** the form MUST initialize target mode and name from the response target
- **AND** saving the form MUST call `PUT /api/v1/cron-tasks/:taskId` with the current target mode represented by the API target contract

#### Scenario: User clears existing target
- **WHEN** the user changes an existing Skill-bound or Workflow-bound task to prompt-only mode and saves
- **THEN** frontend MUST call `PUT /api/v1/cron-tasks/:taskId` with `target` explicitly set to null
- **AND** frontend MUST NOT rewrite the prompt with a directive prefix

### Requirement: Cron task dashboard target selection preserves frontend ownership boundary

Cron task dashboard MUST treat target binding as Cron management API data. The dashboard MUST NOT own request lifecycle, runtime routing, canonical stream/history truth, trusted identity, Agent Scope, Owner Scope, capability authority or persistence. The dashboard MUST NOT send owner, agent, session, run, routing constraints, capability parameters, model profile or credential fields when creating, updating or immediately executing Cron tasks.

#### Scenario: Run-now does not carry target override
- **WHEN** the user clicks execute on a Skill-bound or Workflow-bound Cron task
- **THEN** frontend MUST call `POST /api/v1/cron-tasks/:taskId/runs` without a request body
- **AND** frontend MUST NOT send target, prompt override, routing constraints, owner scope, Agent scope, session or run fields

#### Scenario: Invalid target input is stopped before request
- **WHEN** the user selects Skill or Workflow mode and leaves target name empty
- **THEN** frontend MUST show a validation error
- **AND** frontend MUST NOT call Cron task management API

### Requirement: Cron task dashboard entry gate

Agent Web MUST 根据 `runtimeConfig.portalAbilityConfig.cronTasksEnabled` 控制定时任务入口可见性。字段为 `true` 或缺失时，入口 MUST 保持当前默认可见行为；字段为 `false` 时，入口 MUST NOT 渲染。

Local、Immersive、Collaborative/PIU 三种宿主 MUST 使用同一个 `cronTasksEnabled` 值控制所有定时任务入口。关闭入口 MUST NOT 影响直达 `/cron-tasks` 路由的既有行为，也 MUST NOT 修改 Cron 任务 API 或任务执行语义。

**需求类别**：功能性需求

#### Scenario: 默认显示定时任务入口

- **WHEN** `cronTasksEnabled` 为 `true` 或缺失
- **THEN** Local、Immersive、Collaborative/PIU 宿主中的定时任务入口 MUST 保持当前可见行为

#### Scenario: 关闭定时任务入口

- **WHEN** `cronTasksEnabled` 为 `false`
- **THEN** Local、Immersive、Collaborative/PIU 宿主中的定时任务入口 MUST NOT 渲染
- **AND** 直达 `/cron-tasks` 路由的既有行为 MUST 保持不变
- **AND** Cron 任务 API 和任务执行语义 MUST 保持不变

#### Scenario: 三宿主入口一致

- **WHEN** `cronTasksEnabled` 为 `false`
- **THEN** Local、Immersive、Collaborative/PIU 中的所有定时任务入口 MUST 均不可见
- **AND** MUST NOT 出现一个宿主隐藏、另一个宿主仍可见的行为
