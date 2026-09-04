# cron-tools Specification

## Purpose
定义 Agent 可调用的 Cron 工具创建、管理和相对延迟调度行为，确保结构化输入被转换为可追踪且受治理的计划任务。

## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Cron Tool 结构化相对延迟创建
系统 SHALL 允许 `Cron(action=create)` 使用结构化 `delay` 表达一次性 elapsed duration。`delay` SHALL 只包含可选的非负整数 `days`、`hours`、`minutes`，每个字段允许自然大值；系统 MUST 将各字段统一换算，总延迟 MUST 为 1 至 525600 分钟。1 day MUST 固定等于 24 hours。`delay` 与 `cron` MUST 恰好选择一个；delay task 的 `recurring` MUST 省略或为 `false`。

#### Scenario: 一小时十分钟后执行
- **WHEN** 调用 `Cron(action=create, delay={hours:1, minutes:10}, prompt=<非空任务>)`
- **THEN** 系统 MUST 创建 one-shot durable task
- **AND** MUST NOT 要求调用方换算为 70 分钟或提供当前时间
- **AND** create 结果 MUST 返回稳定 task id、原始结构化 delay、可读摘要和 `recurring=false`

#### Scenario: 自然大字段由系统归一化
- **WHEN** 调用方提供 `delay={minutes:90}` 或 `delay={hours:48}`
- **THEN** 系统 MUST 分别按 90 分钟和 48 小时计算，不得要求调用方改写单位

#### Scenario: 调度输入冲突
- **WHEN** create 同时提供 `cron` 与 `delay`，或两者均未提供，或 delay 配合 `recurring=true`
- **THEN** runtime schema validation MUST 拒绝调用且不得写入 task

#### Scenario: 非法或越界延迟
- **WHEN** delay 含未知字段、负数、小数，所有字段均为零，或总延迟超过 525600 分钟
- **THEN** 系统 MUST 返回稳定 validation failure 且不得写入 task

### Requirement: Cron 相对延迟使用可信分钟调度
系统 SHALL 使用受信系统时钟在创建操作中冻结相对任务的 `nextRunAt`。目标时间 MUST 等于创建基准加总延迟后向上取整到分钟，量化误差 MUST 小于 1 分钟且任务 MUST NOT 早于请求偏移量执行。该计算 MUST NOT 调用 Bash、Python 或读取 system prompt 时间。

#### Scenario: 跨日并向上取整
- **WHEN** 受信创建时刻为 23:55:30 且 delay 为 10 分钟
- **THEN** 冻结到期时间 MUST 为次日 00:06:00

#### Scenario: 重启不重新计算延迟
- **WHEN** delay task durable commit 后进程在到期前重启
- **THEN** 系统 MUST 继续使用原冻结 `nextRunAt`
- **AND** MUST NOT 以重启时间重新应用 delay

#### Scenario: Sandbox 不可用
- **WHEN** Cron gateway 可用但 sandbox capability 不可用
- **THEN** 合法 delay create MUST 仍能创建任务

#### Scenario: 到期只执行一次
- **WHEN** delay task 到期并成功 claim 首个 trigger
- **THEN** 系统 MUST 沿用现有 one-shot completion 和标准 request lifecycle
- **AND** MUST NOT 再从兼容 cron 字段推导后续执行

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

### Requirement: Cron Tool 调用指导

系统 SHALL 为 `Cron` Tool 及其输入字段提供与实际 schema、解析器和执行生命周期一致的模型可见描述。描述 MUST 使模型能够区分相对 delay、一次性日历 cron、周期 cron、list 和 delete；MUST 说明支持的五段数字 cron 子集、本地时间与分钟精度、recurring 默认行为、delay 总量边界以及 task scope 容量。描述 MUST NOT 把单轮副作用 Tool 调用限制表述为 Cron 的总任务上限。

描述中的 scope 容量 MUST 指当前 trusted scope 最多保存 50 个 ACTIVE task；已完成或已删除 task MUST NOT 被描述为仍占用容量。描述 MUST NOT 声称 `COMPLETED` 或 `DELETED` task 会阻止新任务创建。

#### Scenario: 容量与单轮限制不混淆

- **WHEN** 一次用户意图需要创建多个 Cron task
- **THEN** 描述 MUST 说明当前 scope 最多保存 50 个 ACTIVE task
- **AND** MUST 说明单轮最多 5 次副作用调用不是 Cron 总容量，剩余创建应由后续执行轮次继续
- **AND** MUST NOT 把 COMPLETED 或 DELETED task 描述为仍占用容量

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

### Requirement: Cron 本地日历匹配保持未来顺序

系统 MUST 使用进程本地时区解释五段 cron 表达式的日历字段。系统计算下一次命中时，返回的 `nextRunAt` MUST 严格晚于输入起点。DST 春季切换导致目标本地分钟不存在时，系统 MUST 跳过该本地分钟并继续查找后续日历命中。DST 秋季切换导致同一本地日期和分钟对应两个 offset 时，系统 MUST 只把较早 offset 对应的 instant 视为该日历分钟的命中；该 instant 不晚于输入起点时，系统 MUST 继续查找下一个不同的日历命中，MUST NOT 返回较晚 offset 对应的重复分钟。

**需求类别**：功能性需求

#### Scenario: 普通日历命中严格晚于起点

- **WHEN** 系统从任一有效起点计算五段 cron 表达式的下一次命中
- **THEN** 返回的 `nextRunAt` MUST 严格大于输入起点

#### Scenario: 春季缺口跳过不存在时间

- **WHEN** 进程时区为 `America/New_York`，输入起点为 `2026-03-08T06:59:00.000Z`，cron 表达式为 `0 2 * * *`
- **THEN** 下一次命中 MUST 为 `2026-03-09T06:00:00.000Z`
- **AND** 系统 MUST NOT 为 `2026-03-08` 生成 `02:00` 命中

#### Scenario: 秋季重叠只选择较早 offset

- **WHEN** 进程时区为 `America/New_York`，系统从 `2026-10-31T05:30:00.000Z` 计算 `30 1 * * *` 的下一次命中
- **THEN** 下一次命中 MUST 为 `2026-11-01T05:30:00.000Z`
- **AND** 系统从该命中继续计算时，下一次命中 MUST 为 `2026-11-02T06:30:00.000Z`
- **AND** 系统 MUST NOT 返回 `2026-11-01T06:30:00.000Z` 对应的重复 `01:30`

#### Scenario: 秋季第二个重复小时不回到过去

- **WHEN** 进程时区为 `America/New_York`，输入起点为 `2026-11-01T06:15:30.000Z`，cron 表达式为 `30 1 * * *`
- **THEN** 下一次命中 MUST 为 `2026-11-02T06:30:00.000Z`
- **AND** 系统 MUST NOT 返回早于输入起点的 `2026-11-01T05:30:00.000Z`

### Requirement: Cron 创建执行 ACTIVE 任务容量限制

系统 MUST 对每个 trusted Cron task scope（`tenantId + subjectId + agentId`）的 ACTIVE task 数量执行固定上限 50。容量判定 MUST 只统计 `status='ACTIVE'` 的 durable task；`COMPLETED` 和 `DELETED` task MUST NOT 占用额度。Cron Tool create、Web management create 以及任何主路径 durable create MUST 使用同一可观察容量不变量。

当新 create 会使当前 scope 的 ACTIVE task 数量超过 50 时，系统 MUST 返回 `AgentError { code: 'CRON_TASK_LIMIT_REACHED', category: 'CONFLICT', retryable: false }`，并 MUST NOT 创建 task、创建 trigger、修改既有 task 或推进任何持久化状态。幂等重放 MUST 先于容量检查返回首次已持久化结果。并发 create MUST NOT 使同一 scope 的 ACTIVE task 数量超过 50。LOCAL 与 REMOTE deployment MUST 提供相同的容量拒绝可观察语义；REMOTE backend MUST 在自身 durable create 边界提供权威拒绝，不得仅依赖调用方 count 预检。

**需求类别**：系统质量属性
**质量属性**：容量、可靠性/恢复、安全
**适用范围**：该 Function

#### Scenario: 第 50 个 ACTIVE task 被接受

- **WHEN** 当前 trusted scope 已有 49 个 ACTIVE task
- **AND** 系统收到一个合法 Cron create
- **THEN** gateway MUST 接受写入
- **AND** scope 内 ACTIVE task 数量变为 50

#### Scenario: 第 51 个 ACTIVE task 被拒绝

- **WHEN** 当前 trusted scope 已有 50 个 ACTIVE task
- **AND** 系统收到一个合法 Cron create
- **THEN** gateway MUST 返回 `CRON_TASK_LIMIT_REACHED`
- **AND** 错误 category MUST 为 `CONFLICT` 且 `retryable=false`
- **AND** gateway MUST NOT 插入新 task、修改既有 task 或改变 scope 内 ACTIVE 数量

#### Scenario: COMPLETED 和 DELETED task 不占用额度

- **WHEN** scope 内有任意数量的 `COMPLETED` 或 `DELETED` task
- **AND** 当前 ACTIVE task 少于 50
- **THEN** 新 create MUST 可以成功
- **AND** 容量检查 MUST NOT 把这些非 ACTIVE task 计入

#### Scenario: 完成一次性任务释放额度

- **WHEN** scope 内已有 50 个 ACTIVE task
- **AND** 其中一个 one-shot task 成功 claim 后变为 `COMPLETED`
- **THEN** 后续合法 create MUST 可以成功
- **AND** 新 task 创建后 ACTIVE 数量必须仍不超过 50

#### Scenario: 容量按 trusted scope 隔离

- **WHEN** 当前 scope 已有 50 个 ACTIVE task
- **AND** 新 create 属于不同 tenant、subject 或 agent scope
- **THEN** 该 create 的容量检查 MUST 只统计自身 scope
- **AND** MUST NOT 因其他 scope 满额而失败

#### Scenario: 幂等重放不受容量限制影响

- **WHEN** scope 内已有 50 个 ACTIVE task
- **AND** 一个 create 在达到上限前已通过同一 idempotency key 持久化
- **AND** client 以相同 key 重放该 create
- **THEN** gateway MUST 返回首次已持久化结果
- **AND** gateway MUST NOT 因当前满额而返回容量错误

#### Scenario: 并发创建不得突破 50

- **WHEN** 多个并发 create 在 scope 已有 49 个 ACTIVE task 时提交
- **THEN** gateway MUST 恰好接受其中一个新 task
- **AND** 其余 create MUST 以 `CRON_TASK_LIMIT_REACHED` 失败
- **AND** durable scope 内 ACTIVE task 数量 MUST 最终为 50
