## ADDED Requirements

### Requirement: Cron is an eager built-in Tool
The system SHALL expose the canonical `Cron` Tool on the default model Tool surface whenever the trusted deployment selects a usable Cron gateway adapter. `Cron` MUST declare eager disclosure and MUST NOT require a `ToolSearch` activation step before model invocation. The default LOCAL system configuration SHALL select the SQLite-backed `cron-tasks` adapter so the bundled `Cron` Tool is available after ordinary local startup.

#### Scenario: ToolSearch mode keeps Cron loaded by default
- **WHEN** the system uses `tool-disclosure-mode=tool-search` and the LOCAL Cron gateway is ready
- **THEN** the first model invocation MUST include the canonical `Cron` Tool
- **AND** the model MUST be able to call `Cron(action=create|list|delete)` without first calling `ToolSearch`

#### Scenario: Missing Cron dependency still fails closed
- **WHEN** a custom deployment does not select or provide a Cron gateway adapter
- **THEN** the system MUST NOT expose a non-executable `Cron` Tool merely because it declares eager disclosure

### Requirement: Cron Tool 调用
系统 SHALL 注册单一 `Cron` 内置 Tool，并在调用前对输入执行 runtime schema validation。`Cron` MUST 通过 `action=create|list|delete` 区分创建、列表和删除操作；`action=create` MUST 接受受支持的 cron 表达式、非空 prompt 和 recurring 标志；task scope MUST 仅来自受信执行上下文。

#### Scenario: 创建、查询和删除任务
- **WHEN** 同一 owner、Agent 和 session 依次调用 `Cron` 的 `action=create`、`action=list`、`action=delete`
- **THEN** 创建结果返回稳定 task id，列表只包含该 scope 的任务，删除后列表不再包含该任务

#### Scenario: 模型不能覆盖 scope
- **WHEN** Tool input 携带 tenant、subject、agent 或 session 伪造字段
- **THEN** 系统 MUST 拒绝未知字段或忽略其 scope 意图，并只使用受信执行上下文

### Requirement: Cron 结果安全投影到 LUI
Web channel SHALL 通过既有 `CAPABILITY_RESULT_DELTA` 把 Cron create/list/delete 的结果投影到 LUI，不得为普通 Cron JSON 结果新增平行 timeline event。投影 MUST 仅包含 action-aware allowlist 字段：稳定 task id、cron 表达式、可读调度、recurring、列表计数和截断状态；MUST NOT 包含 prompt、原始 Tool 参数、任意 metadata 或未知结果字段。列表投影 MUST 最多包含 50 个 task，并保留真实总数与截断标志。

#### Scenario: 创建和删除结果可见
- **WHEN** Web channel 投影成功的 `Cron(action=create)` 或 `Cron(action=delete)` 结果
- **THEN** `CAPABILITY_RESULT_DELTA.payload.safeResult` MUST 使用 `kind=cron` 并包含 action 与稳定 task id
- **AND** create MAY 包含可读调度与 recurring，且 payload MUST NOT 包含 prompt

#### Scenario: 列表结果有界且不暴露 prompt
- **WHEN** Web channel 投影成功的 `Cron(action=list)` 结果
- **THEN** `safeResult.jobs` MUST 最多包含前 50 个 task 的 id、cron、可读调度与 recurring
- **AND** `safeResult` MUST 包含真实 `totalCount` 与 `truncated`
- **AND** stream envelope 的 `safeResult`、`safeSummary`、`text` 与 `content` MUST NOT 包含任一 task prompt

#### Scenario: 未知 Cron 结果 fail closed
- **WHEN** Cron result 缺少 action 所需字段或包含未知 action
- **THEN** Web channel MUST NOT 把原始结果字段复制到 LUI safe result

### Requirement: Durable Cron task
产品路径中的 Cron task SHALL 通过 gateway port 持久化；成功结果返回前 MUST 已 durable commit。LOCAL 与 REMOTE adapter MUST 提供相同的 create/list/delete 可观察语义，进程重启不得丢失已提交且未删除的任务。

#### Scenario: Local 重启恢复
- **WHEN** LOCAL adapter 创建任务后关闭并以同一数据库重新启动
- **THEN** `Cron` 的 `action=list` MUST 返回该任务且不改变其稳定 id、scope、schedule 或状态

#### Scenario: Remote service 持久化
- **WHEN** REMOTE adapter 成功创建任务后 NextAgent 进程重启
- **THEN** `Cron` 的 `action=list` MUST 从外部 Cron service 返回已提交任务，而不是依赖进程内缓存

### Requirement: 到期触发与幂等执行
Cron backend SHALL 为每次到期生成稳定 trigger id。NextAgent MUST 对同一 task id 与 trigger id 至多 acceptance 一次；重复 delivery MUST 返回已接受结果且不得创建第二个 request run。recurring=false 的任务在首次 trigger 成功 claim 后 MUST 不再产生新 trigger。

#### Scenario: 重复回调
- **WHEN** 同一 remote callback 被投递两次
- **THEN** 系统 MUST 只创建一个 request run，并为第二次投递返回幂等成功结果

#### Scenario: Local 到期执行
- **WHEN** LOCAL scheduler 发现一个到期且未 claim 的任务
- **THEN** 系统 MUST 原子 claim trigger，并通过受信 callback boundary 提交一次 request execution

### Requirement: 可信回调与执行恢复
REMOTE callback MUST 通过部署配置的认证和 freshness/replay validation。callback 只可携带 task id、trigger id 和认证 envelope；系统 MUST 从 durable gateway fact 恢复 owner scope、agent scope、session 与 prompt。只有 HMAC 与 freshness 验证成功后，系统 MAY 使用 task id 与 trigger id 执行一次受控 composite bootstrap read；该读取 MUST 同时返回 task 与 trigger，handler MUST 在执行前校验二者 Owner Scope、Agent Scope、session 和 task id 完全一致。认证失败、task 不存在、scope 不一致或 task 已删除时 MUST 不创建 request run。

#### Scenario: callback 试图注入 prompt 或 identity
- **WHEN** callback payload 额外携带 prompt、tenant、subject、agent 或 session
- **THEN** 系统 MUST 不使用这些字段执行，并按 schema/auth policy 拒绝请求

#### Scenario: 合法 callback 创建标准 request
- **WHEN** 合法 callback 引用 active task 和未处理 trigger
- **THEN** 系统 MUST 通过标准 runtime acceptance 创建 request run，且该 run 遵守 same-session lane、cancellation、timeline 和 terminal commit 语义

### Requirement: Cron 安全可观测性
Cron create/delete/trigger/acceptance 的 audit 与 diagnostic SHALL 包含稳定 task/trigger reference、结果状态和 safe reason；MUST NOT 包含 prompt、模型输出、raw callback、credential、token 或路径。

Cron safe observation MUST 使用 `CRON_TASK_CREATED`、`CRON_TASK_DELETED` 或 `CRON_TRIGGER_ACCEPTED` 稳定 operation。create/delete MUST 关联发起 mutation 的 canonical request run；trigger acceptance MUST 在 runtime acceptance 和 durable trigger binding 后关联 authoritative task、trigger、session 与 requestRun，并使用 acceptance 时持久化的 Agent version。上述 observation MUST 通过现有 audit projector 映射为 `cron.task_created`、`cron.task_deleted` 或 `cron.trigger_accepted`，不得新增 Cron 专用 runtime timeline event。

#### Scenario: 远端服务失败
- **WHEN** 外部 Cron service 返回 raw vendor error
- **THEN** Tool 或 callback surface MUST 返回稳定 safe error，日志和 audit 不得包含 raw vendor body 或 credential

#### Scenario: Cron audit 只包含稳定引用
- **WHEN** Cron task 成功创建、删除或 trigger 成功绑定标准 request run
- **THEN** audit MUST 包含对应 task reference、session、requestRun、Agent version 与安全结果，trigger acceptance 还 MUST 包含 trigger reference
- **AND** audit MUST NOT 包含 task prompt、模型输出、raw callback、credential、vendor error、token 或路径
