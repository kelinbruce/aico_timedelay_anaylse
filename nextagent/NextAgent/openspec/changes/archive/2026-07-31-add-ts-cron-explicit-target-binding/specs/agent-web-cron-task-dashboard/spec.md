## ADDED Requirements

### Requirement: Cron 任务看板展示显式 target 绑定

Cron task dashboard MUST 展示 Cron task management API 返回的显式 target 绑定。`target.kind="SKILL"` 的任务 MUST 被明确标识为 Skill 任务并显示 `target.name`。`target.kind="WORKFLOW"` 的任务 MUST 被明确标识为 Workflow 任务并显示 `target.name`。没有 target 的任务 MUST 被明确标识为仅 prompt 的计划任务或不显示 target 徽章；只有当任务内容保持可见且不显示虚假的 Skill 或 Workflow 绑定时，两种结果才都合规。

#### Scenario: 看板渲染 Skill target
- **WHEN** 任务列表 API 返回一个带 `target.kind="SKILL"` 和 `target.name="alarm-diagnosis"` 的 Cron 任务
- **THEN** 任务卡片 MUST 显示包含 `alarm-diagnosis` 的 Skill target 标识
- **AND** 该卡片 MUST 继续显示任务 prompt、schedule、frequency、next run 和操作

#### Scenario: 看板渲染 Workflow target
- **WHEN** 任务列表 API 返回一个带 `target.kind="WORKFLOW"` 和 `target.name="ran-alarm-diagnosis"` 的 Cron 任务
- **THEN** 任务卡片 MUST 显示包含 `ran-alarm-diagnosis` 的 Workflow target 标识
- **AND** 该卡片 MUST 继续显示任务 prompt、schedule、frequency、next run 和操作

#### Scenario: 看板不从 prompt 文本推断 target
- **WHEN** 任务列表 API 返回一个不带 `target` 的 Cron 任务
- **THEN** 看板 MUST NOT 通过从 prompt 解析 `$skill:` 或 `$workflow:` 来显示 Skill 或 Workflow target 徽章
- **AND** 看板展示的执行行为 MUST 保持基于 API 返回的 target 字段

### Requirement: Cron 任务看板管理显式 target 绑定

Cron task dashboard 的创建和编辑表单 MUST 允许用户在恰好三种 target 模式中选择：仅 prompt、Skill 或 Workflow。仅 prompt 模式 MUST 不提交 target。Skill 模式 MUST 提交 `target.kind="SKILL"` 和用户选择或用户输入的 Skill 名称。Workflow 模式 MUST 提交 `target.kind="WORKFLOW"` 和用户输入的 Workflow 名称。表单 MUST 要求在提交 Skill 或 Workflow 模式前 target 名称非空。

#### Scenario: 用户创建仅 prompt 的 Cron 任务
- **WHEN** 用户以仅 prompt 的 target 模式提交创建表单
- **THEN** frontend MUST 调用 `POST /api/v1/cron-tasks` 且不带 `target` 字段
- **AND** frontend MUST 仍发送有效的 `cron`、`prompt` 和 `recurring`

#### Scenario: 用户创建绑定 Skill 的 Cron 任务
- **WHEN** 用户以 Skill target 模式和名称 `alarm-diagnosis` 提交创建表单
- **THEN** frontend MUST 以 `target.kind="SKILL"` 和 `target.name="alarm-diagnosis"` 调用 `POST /api/v1/cron-tasks`
- **AND** frontend MUST NOT 将 `$skill:alarm-diagnosis` 嵌入 `prompt`
- **AND** frontend MUST NOT 发送 `routingConstraints.targetSkill`

#### Scenario: 用户创建绑定 Workflow 的 Cron 任务
- **WHEN** 用户以 Workflow target 模式和名称 `ran-alarm-diagnosis` 提交创建表单
- **THEN** frontend MUST 以 `target.kind="WORKFLOW"` 和 `target.name="ran-alarm-diagnosis"` 调用 `POST /api/v1/cron-tasks`
- **AND** frontend MUST NOT 将 `$workflow:ran-alarm-diagnosis` 嵌入 `prompt`
- **AND** frontend MUST NOT 发送 `routingConstraints.targetRecipe`

#### Scenario: 用户编辑既有 target
- **WHEN** 用户编辑一个响应中包含 target 的既有 Cron 任务
- **THEN** 表单 MUST 从响应 target 初始化 target 模式和名称
- **AND** 保存表单 MUST 以 API target 契约表示的当前 target 模式调用 `PUT /api/v1/cron-tasks/:taskId`

#### Scenario: 用户清除既有 target
- **WHEN** 用户将一个已绑定 Skill 或 Workflow 的任务改为仅 prompt 模式并保存
- **THEN** frontend MUST 调用 `PUT /api/v1/cron-tasks/:taskId` 并显式将 `target` 设为 null
- **AND** frontend MUST NOT 用指令前缀改写 prompt

### Requirement: Cron 任务看板 target 选择保持前端所有权边界

Cron task dashboard MUST 将 target 绑定视为 Cron management API 数据。看板 MUST NOT 拥有 request lifecycle、runtime routing、canonical stream/history truth、trusted identity、Agent Scope、Owner Scope、capability authority 或 persistence。看板在创建、更新或立即执行 Cron 任务时 MUST NOT 发送 owner、agent、session、run、routing 约束、capability 参数、model profile 或 credential 字段。

#### Scenario: 立即执行不携带 target 覆盖
- **WHEN** 用户点击一个已绑定 Skill 或 Workflow 的 Cron 任务上的执行
- **THEN** frontend MUST 调用 `POST /api/v1/cron-tasks/:taskId/runs` 且不带请求体
- **AND** frontend MUST NOT 发送 target、prompt 覆盖、routing 约束、owner scope、Agent scope、session 或 run 字段

#### Scenario: 非法 target 输入在请求前被拦截
- **WHEN** 用户选择 Skill 或 Workflow 模式但将 target 名称留空
- **THEN** frontend MUST 显示校验错误
- **AND** frontend MUST NOT 调用 Cron task management API
