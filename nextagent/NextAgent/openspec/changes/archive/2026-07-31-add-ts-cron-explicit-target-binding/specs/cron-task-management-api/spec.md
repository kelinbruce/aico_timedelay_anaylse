## ADDED Requirements

### Requirement: Cron 任务管理 API 支持显式 target 绑定

Cron task management API MUST 在公开的任务 create、update 和响应 DTO 上支持可选 `target` 字段。当 `target` 存在时，它 MUST 以等于 `SKILL` 或 `WORKFLOW` 的 `kind` 和等于安全 capability 标识符的 `name` 精确标识一个 Cron 任务执行目标。当 `target` 缺席时，Cron 任务 MUST 保持当前仅 prompt 的执行行为。

#### Scenario: 创建仅 prompt 的 Cron 任务
- **WHEN** 客户端发送带有效 `cron`、非空 `prompt`、可选 `recurring` 且不带 `target` 的 `POST /api/v1/cron-tasks`
- **THEN** Web channel MUST 创建一个不带显式 target 的持久 Cron 任务
- **AND** 响应 MUST 省略 `target`
- **AND** 未来的触发投递 MUST 提交任务 prompt 且不带 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe`

#### Scenario: 创建绑定 Skill 的 Cron 任务
- **WHEN** 客户端发送带 `target.kind="SKILL"` 和有效 `target.name` 的 `POST /api/v1/cron-tasks`
- **THEN** Web channel MUST 创建一个公开 DTO 包含相同 target kind 和 name 的持久 Cron 任务
- **AND** 未来的触发投递 MUST 提交任务 prompt 并带等于 `target.name` 的 `routingConstraints.targetSkill`
- **AND** 投递 MUST NOT 设置 `routingConstraints.targetRecipe`

#### Scenario: 创建绑定 Workflow 的 Cron 任务
- **WHEN** 客户端发送带 `target.kind="WORKFLOW"` 和有效 `target.name` 的 `POST /api/v1/cron-tasks`
- **THEN** Web channel MUST 创建一个公开 DTO 包含相同 target kind 和 name 的持久 Cron 任务
- **AND** 未来的触发投递 MUST 提交任务 prompt 并带等于 `target.name` 的 `routingConstraints.targetRecipe`
- **AND** 投递 MUST NOT 设置 `routingConstraints.targetSkill`

#### Scenario: 更新 Cron 任务 target
- **WHEN** 客户端发送带有效 `target` 的 `PUT /api/v1/cron-tasks/:taskId`
- **THEN** Web channel MUST 只更新当前可信 owner 和 active Agent 作用域内的任务
- **AND** 响应 MUST 包含已更新的 target
- **AND** 已接受的 trigger/run 事实 MUST NOT 被改写

#### Scenario: 清除 Cron 任务 target
- **WHEN** 客户端发送显式将 `target` 设为 null 的 `PUT /api/v1/cron-tasks/:taskId`
- **THEN** Web channel MUST 清除持久 Cron 任务 target
- **AND** 后续触发投递 MUST 提交任务 prompt 且不带 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe`

### Requirement: Cron 任务 target 输入 fail closed

Cron task management API MUST 在调用 Cron task gateway 前校验 `target`。`target.kind` MUST 是 `SKILL` 或 `WORKFLOW` 之一。`target.name` MUST 是使用与 runtime routing 约束 target 标识符相同允许字符类的非空安全标识符。API MUST 拒绝带未知字段、缺失字段、空名称、非法名称、不支持的 kind 或冲突 legacy target 字段的 target 对象。

#### Scenario: 非法 target 被拒绝
- **WHEN** create 或 update 请求体包含非法 `target`
- **THEN** Web channel MUST 返回安全的 400 校验错误
- **AND** Cron task gateway MUST NOT 创建或修改任务

#### Scenario: 客户端无法通过 Cron 任务 target 夹带 routing 约束
- **WHEN** create 或 update 请求体在已定义的 Cron 任务 body 之外包含 `routingConstraints`、`targetSkill`、`targetRecipe`、owner scope、Agent scope、session、run、capability 参数或 prompt 覆盖字段
- **THEN** Web channel MUST 返回安全的 400 校验错误
- **AND** 系统 MUST NOT 创建或修改 Cron 任务

#### Scenario: 显式 target 拒绝 prompt 指令冲突
- **WHEN** create 或 update 请求会使一个 Cron 任务同时带有结构化 `target` 和包含有效 `$skill:` 或 `$workflow:` 指令的 prompt
- **THEN** Cron task management API MUST 返回安全的 400 校验错误
- **AND** 系统 MUST NOT 创建或修改 Cron 任务

### Requirement: Cron 任务 target 是持久管理事实

Cron 任务 target MUST 作为 Cron 任务持久事实的一部分被持久化。一个不带 target 的已持久任务 MUST 仍是有效任务。Query、create 和 update 响应 MUST 只通过公开 DTO `target` 字段暴露 target，MUST NOT 暴露数据库列名、gateway 专属字段名、idempotency key、version、owner 字段、trigger 事实或 runtime routing 内部细节。

#### Scenario: target 在重启后保留
- **WHEN** 一个绑定 Skill 或 Workflow 的 Cron 任务成功创建且应用以同一持久 Cron gateway 重启
- **THEN** `GET /api/v1/cron-tasks` MUST 返回带相同 `target.kind` 和 `target.name` 的任务

#### Scenario: legacy 或未绑定任务保持仅 prompt
- **WHEN** 一个 Cron 任务在 target 支持之前创建或创建时不带 target
- **THEN** 查询响应 MUST 保持有效
- **AND** 该任务 MUST 以仅 prompt 方式执行，除非后续 update 设置 target

### Requirement: Cron target 投递保持 runtime 治理

Cron 触发投递 MUST 只在服务端投递边界把持久 target 转换为 runtime routing 约束。该转换 MUST NOT 直接执行 Skill 或 Workflow、绕过 runtime acceptance、绕过 agent-core routing 或绕过 capability governance。如果 target 指向的 Skill 或 Workflow 在已接受的 Agent scope 中不可用，该 run MUST 遵循该 target kind 既有的 runtime/core 失败、拒绝或回退行为。

#### Scenario: target 执行进入标准 request lifecycle
- **WHEN** 一个到期 trigger 被认领且其 Cron 任务带有 target
- **THEN** 投递 MUST 创建或复用服务端 Cron 执行 session
- **AND** 投递 MUST 以任务 prompt、可信 owner scope、可信 Agent scope、低优先级和映射后的 routing 约束调用 runtime submit
- **AND** 已接受的 run MUST 通过既有 trigger/run 绑定回绑到该 Cron trigger

#### Scenario: target 不覆盖可信作用域
- **WHEN** 一个 Cron 任务配置了 target
- **THEN** 投递 MUST 从任务持久事实派生 owner scope，并从任务 `agentId` 派生 Agent scope
- **AND** target MUST NOT 覆盖 tenant、subject、agent、session、run、model profile、capability provider、credential、prompt 文本或附件 id
