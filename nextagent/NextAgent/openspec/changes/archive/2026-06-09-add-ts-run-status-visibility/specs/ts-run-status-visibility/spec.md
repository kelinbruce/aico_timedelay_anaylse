## ADDED Requirements

### Requirement: Run status visibility 的事实源
TS 后端 SHALL 只从 canonical `RequestRun.status` 和 committed runtime timeline 生成用户可见请求状态与 stream projection。Web channel、frontend、transport adapter、模型输出、能力输出或 projection cache MUST NOT 创建与 runtime facts 竞争的请求生命周期状态、终态或执行事实。

#### Scenario: request accepted 事件可见
- **WHEN** runtime 接受用户请求、创建 durable `RequestRun` 并发布 `REQUEST_ACCEPTED`
- **THEN** stream projection MUST 使用 `REQUEST_ACCEPTED`
- **AND** 用户可见状态 MUST 暴露该 run 当前 canonical `RequestRun.status`
- **AND** 如果当前主路径将受理后的 run 持久化为 `QUEUED`，用户可见状态 MUST 暴露 canonical `QUEUED` 而不是伪造 `ACCEPTED`
- **AND** 输出 MUST 可追溯到产生该状态的 run 或 timeline fact

#### Scenario: canonical status 原样可见
- **WHEN** 用户可见状态读取或 stream projection 需要表达 run lifecycle
- **THEN** 输出 MUST 原样使用 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING`、`COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`
- **AND** 输出 MUST NOT 使用 transport-private status、frontend-local status 或 deprecated projection name 代替 canonical status

#### Scenario: 降级不是 RunStatus
- **WHEN** 模型、能力、context、checkpoint、audit、metric 或 transport 发生降级但 request lifecycle 仍可继续
- **THEN** `RunStatus` MUST 保持当前生命周期状态
- **AND** 降级 MUST 通过 `DEGRADATION_NOTICE`、safe error、audit event 或 observability metric 表达
- **AND** 系统 MUST NOT 引入 `DEGRADED` 或任何降级专用 `RunStatus`

### Requirement: Status visibility 触发条件和前置条件
TS 后端 SHALL 在已提交的 request lifecycle fact 可用时触发状态可见性投影，包括 admission、queue、planning、execution、model delta、capability invocation、context compaction、pending input、degradation、cancel、supersede 和 terminal fact。Status projection SHALL 是异步观察流程，MUST NOT 推进 runtime lifecycle，MUST NOT 生产 pending input、cancel、supersede、policy 或 compaction facts，也 MUST NOT 重新执行模型、能力、hook、pending input、checkpoint 或 terminal commit。

#### Scenario: committed fact 触发 projection
- **WHEN** runtime 提交 run status transition 或 committed timeline event
- **THEN** status projection MUST 以该 committed fact 作为输入
- **AND** projection MUST NOT 在 fact 提交前向用户暴露对应状态或 stream event

#### Scenario: projection 前置条件满足
- **WHEN** Web channel 准备投影 run status 或 stream event
- **THEN** 系统 MUST 已具备可信 identity、owner-scoped `sessionId`、`rootMessageId`、可选 `runId`、canonical run/timeline reader、timeline sequence、redaction boundary 和 SafeError normalizer
- **AND** client-supplied owner、tenant、subject 或等价字段 MUST NOT 覆盖 channel/auth boundary 注入的可信 identity

#### Scenario: pending input 前置条件满足
- **WHEN** pending input lifecycle fact 或 safe summary 已由 runtime-owned pending input boundary 提交并需要投影给用户
- **THEN** projection MUST 使用 runtime-owned pending input fact 或 safe summary
- **AND** projection MUST NOT 接受模型输出、客户端 payload 或 transport-private state 自报的 pending input status

### Requirement: Canonical stream projection vocabulary 约束
TS 后端 SHALL 将用户可见 stream event 投影限制在 core contracts 已冻结的 first-release `StreamEventType` vocabulary。Projection MUST 只消费 canonical timeline event 或 runtime status；MUST NOT 发明 deprecated、transport-specific 或 frontend-only event name。

#### Scenario: 模型和能力事件使用 canonical 名称
- **WHEN** timeline 中存在模型 thinking、模型 content、能力开始、能力结果增量或能力完成事实
- **THEN** stream projection MUST 分别输出 `LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED`
- **AND** 输出 MUST 保留来源 timeline event 的追溯引用

#### Scenario: terminal event 使用 canonical 名称
- **WHEN** runtime 发布 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** stream projection MUST 输出匹配的 terminal stream event
- **AND** Web channel MUST NOT 因 stream close、client disconnect、empty output、transport success 或 projection cache 命中而合成 `REQUEST_COMPLETED`

#### Scenario: timeline-only event 不进入首版 stream
- **WHEN** timeline 中出现 `HOOK_DECISION_APPLIED` 或 `POLICY_APPLIED`
- **THEN** 首版 stream projection MUST NOT 将其输出为用户可见 stream event
- **AND** 需要暴露这类事件时 MUST 先通过 contract refinement change 修改核心 vocabulary

#### Scenario: deprecated projection name 被拒绝
- **WHEN** 任一投影路径尝试输出 `STREAM_STARTED`、`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED` 或 `CAPABILITY_DISCOVERED`
- **THEN** 系统 MUST 将其视为 projection contract violation
- **AND** deprecated name MUST NOT 被发送给用户可见 stream
- **AND** 系统 MUST 记录 safe diagnostic log 或 metric

### Requirement: Projection decision order 约束
TS 后端 SHALL 使用确定的 status projection 判断顺序：先校验 trusted identity 和 owner scope，再校验 request/run/timeline 坐标，再校验 canonical status/event vocabulary，再执行 event-specific projection 与 redaction，最后输出 stream/status、safe diagnostic、audit event 或 observability metric。不同 transport MUST NOT 使用互相冲突的判断顺序。

#### Scenario: owner scope 优先
- **WHEN** 用户读取或订阅 status、stream event 或 pending input visibility
- **THEN** 系统 MUST 在返回任何 run、timeline、pending input、model output 或 capability result 事实前校验 owner scope
- **AND** 校验失败 MUST 返回 authorization/not found safe error
- **AND** 响应 MUST NOT 暴露未授权对象是否存在

#### Scenario: vocabulary 校验早于输出
- **WHEN** projection 输入包含未知 status、未知 timeline event type 或不允许的 stream event type
- **THEN** 系统 MUST 返回 safe projection failure 或记录 contract violation diagnostic
- **AND** 系统 MUST NOT 输出未知或 deprecated 用户可见 event

#### Scenario: redaction 早于 payload 输出
- **WHEN** timeline payload 需要投影为用户可见 payload
- **THEN** projection MUST 在输出前执行 channel-safe projection 和 redaction
- **AND** raw prompt、raw model output、tool args/result、attachment content、secret、credential、本地路径或未授权对象内容 MUST NOT 进入用户可见 stream、safe log、audit event 或 metric

### Requirement: Stream projection artifact contract 约束
TS 后端 SHALL 将 `StreamEnvelope` 作为用户可见 wire projection，而不是 durable execution fact。`StreamEnvelope` MUST 保留 core contracts 已定义的 business coordinates、sequence、canonical event type、optional `timelineEventRef`、transport hints、payload 和 `createdAt` 语义；projection diagnostic MUST NOT 替代 canonical timeline、RequestRun、checkpoint、pending input、artifact、memory record 或 learning event。

#### Scenario: StreamEnvelope 可追溯但不替代事实
- **WHEN** stream envelope 从 timeline event 投影生成
- **THEN** envelope MUST 保留 `sessionId`、`requestId`、optional run/context refs、sequence、canonical event type 和 `timelineEventRef`
- **AND** `timelineEventRef` MUST 只作为追溯引用
- **AND** 消费方 MUST NOT 因拥有 `timelineEventRef` 而获得 raw timeline payload、raw model output、raw tool result 或 raw attachment content 权限

#### Scenario: diagnostic 不是执行事实
- **WHEN** projection 记录 latency、projection failure、redaction failure、runtime unavailable 或 delivery failure
- **THEN** diagnostic MUST 作为 safe log、metric 或 audit event 安全摘要记录
- **AND** diagnostic MUST NOT 被写入 canonical execution timeline 作为业务执行事实

### Requirement: Pending input status visibility 约束
TS 后端 SHALL 在 runtime-owned pending input boundary 已提交 `USER_INPUT_*` fact 时，通过 canonical `USER_INPUT_*` stream event 和 status visibility 暴露 pending input 生命周期。Pending input visibility MUST 保持 runtime-owned pending input boundary，且 MUST 只暴露核心契约允许的安全字段。本 capability MUST NOT 实现 pending input 创建、回答、超时或取消的生产路径。

#### Scenario: 用户输入请求可见
- **WHEN** runtime 为 active run 创建 pending input request
- **THEN** stream projection MUST 输出 `USER_INPUT_REQUIRED`
- **AND** payload MUST 使用 safe `PendingInputRequest` 形态，只包含 `id`、`sessionId`、`kind`、`questions` 和 `timeoutAt`
- **AND** payload MUST NOT 包含 identity、idempotency key、timeout behavior、raw prompt、raw answer 或 model-formatted answer

#### Scenario: 用户输入结果可见
- **WHEN** pending input 被收到、超时或取消
- **THEN** stream projection MUST 输出 `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED`
- **AND** payload MUST 只包含 pending input id、kind、status 和安全摘要字段
- **AND** raw answer content MUST NOT 通过 status visibility 输出

### Requirement: Flow integration 和 downstream consumption
TS 后端 SHALL 将 run status visibility 接入已存在的 runtime lifecycle facts、timeline publisher facts、pending input facts、terminal events 和 Web channel stream projection。本 change SHALL 产出可被未来 audit/observability owning changes 消费的 `StreamEnvelope`、safe diagnostic 或 canonical timeline refs；本 change MUST NOT 实现新的 audit sink、metric sink 或 observability contract。任何 downstream consumer MUST NOT consume adapter-private state as execution truth。

#### Scenario: Web channel 只投影 runtime facts
- **WHEN** SSE 或 WebSocket 向用户暴露请求进度
- **THEN** Web channel MUST 读取 runtime-owned run/timeline facts 并投影为用户可见输出
- **AND** Web channel MUST NOT 持久化 transport-private RequestRun lifecycle、terminal state 或 competing execution fact

#### Scenario: downstream 消费安全投影
- **WHEN** frontend 消费 status visibility 输出，或未来 audit/observability owning change 消费该输出
- **THEN** 消费方 MUST 使用 `StreamEnvelope`、safe diagnostic 或 canonical timeline reference
- **AND** 消费方 MUST NOT 依赖 Web adapter private buffer、connection state 或 frontend-local state 作为事实来源

### Requirement: 显式 projection failure visibility
TS 后端 SHALL 对 status projection 中的 timeout、unavailable、projection resource-limit、read failure、projection failure、dependency missing、redaction failure、serialization failure 和 terminal projection failure 执行显式安全失败或降级提示。系统 MUST NOT 静默截断、静默丢弃、静默吞错或把 projection failure 投影为 successful terminal status。

#### Scenario: runtime 或 timeline 不可用
- **WHEN** projection 无法读取 required run 或 timeline facts，因为 runtime/gateway/timeline reader 不可用、超时、projection resource-limit 或依赖缺失
- **THEN** 系统 MUST 返回 SafeError 或 safe diagnostic
- **AND** 系统 MUST 返回可被 structured log、audit event 或 metric consumer 使用的 safe diagnostic
- **AND** 系统 MUST NOT 输出伪造 terminal event

#### Scenario: redaction 或 serialization 失败
- **WHEN** event payload redaction、SafeError normalization 或 transport serialization 失败
- **THEN** 系统 MUST NOT 输出 raw payload
- **AND** 系统 MUST 返回 safe projection failure 或 safe transport error
- **AND** diagnostic MUST NOT 包含 raw prompt、raw model output、tool args/result、attachment content、secret、credential、本地路径或未授权对象内容

#### Scenario: terminal projection 失败
- **WHEN** terminal timeline event 无法被安全投影为 terminal stream event
- **THEN** 系统 MUST 返回 safe diagnostic 或 safe transport error
- **AND** 系统 MUST 返回可追溯的 safe diagnostic，供 safe log、audit event 或 metric consumer 使用
- **AND** 系统 MUST NOT 输出伪 `REQUEST_COMPLETED`

### Requirement: Run status visibility 验收样例
TS 后端 SHALL 用验收样例覆盖正常路径、边界路径和失败/降级路径。验收 MUST 证明同一 `RequestRun` 的用户可见 status 和 stream projection 不产生互相冲突的用户可见事实。

#### Scenario: 正常路径
- **WHEN** 一个 request 完整提交 `REQUEST_ACCEPTED`、model delta、capability events、content delta 和 `REQUEST_COMPLETED`
- **THEN** stream MUST 暴露 canonical event sequence
- **AND** 用户可见 status MUST 最终暴露 `COMPLETED`
- **AND** 每个从 timeline 投影的 stream event MUST 可追溯到 source timeline event

#### Scenario: 边界路径
- **WHEN** RequestRun 处于 `QUEUED`、`PLANNING` 或 `EXECUTING`
- **THEN** 用户可见 status MUST 原样暴露当前 canonical status
- **AND** stream projection MUST NOT 发明未冻结的 planning、queue 或 executing stream event name
- **AND** partial output MUST NOT 被标记为 final terminal state

#### Scenario: 失败和降级路径
- **WHEN** projection 遇到 timeline read timeout、terminal projection failure、redaction failure 或 runtime unavailable
- **THEN** 系统 MUST 返回 safe error、safe diagnostic 或 `DEGRADATION_NOTICE`
- **AND** 系统 MUST 返回可追溯的 safe diagnostic，供 safe log、audit event 或 metric consumer 使用
- **AND** 系统 MUST NOT 输出伪 completed 或 deprecated stream event
