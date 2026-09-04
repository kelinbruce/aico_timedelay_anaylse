## MODIFIED Requirements

### Requirement: Run Status Visibility Source Of Truth
TS 后端 SHALL 只从 canonical `RequestRun.status` 和 committed runtime timeline 生成用户可见请求状态与 stream projection。Web channel、frontend、transport adapter、模型输出、能力输出或 projection cache MUST NOT 创建与 runtime facts 竞争的请求生命周期状态、终态或执行事实。

Budget-driven 或 output-window-driven 的用户可见 explainability MUST 通过 runtime-owned degradation 事实投影，MUST NOT 由 channel adapter 或 UI 代码独立发明。投影出的 `DEGRADATION_NOTICE` MUST 是 presentation-safe 的：只包含安全 reason code、安全摘要、受影响上下文类别和 continuation/partial-result 提示，MUST NOT 暴露 raw prompt、raw history、raw attachment/tool content、本地路径、secret 或 raw provider payload。

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

#### Scenario: 上下文预算降级是 runtime-owned
- **WHEN** context assembly 或 query policy 判定预算压力导致 summary replacement、trim、context omission、`PRE_SEND_CHECK_REQUIRED` 或显式 insufficient-context 降级，且对用户可见有影响
- **THEN** runtime 在受影响请求进展之前或同时发布 canonical degradation 事实
- **AND** channel projection MUST 以该 runtime-owned 事实作为任何用户可见 degrade notice 的来源
- **AND** channel adapter 或 UI MUST NOT 独立合成该 degrade notice

#### Scenario: 预算与输出窗口 notice 是 presentation-safe
- **WHEN** runtime 向 SSE 或 WebSocket 客户端投影 context-budget 或 output-window degradation notice
- **THEN** payload 只包含 presentation-safe reason code、安全摘要、受影响上下文类别和 continuation/partial-result 提示
- **AND** payload MUST NOT 暴露 raw prompt text、raw history text、raw attachment content、本地路径、secret 或 raw provider payload

#### Scenario: 输出窗口 partial-result notice 可重放
- **WHEN** output-window guard 返回 continuation 或 degraded partial-result，且 runtime 发出 degradation notice
- **THEN** 之后重放该 stream 仍显示相同 notice 语义
- **AND** 该 notice 仍是 runtime-owned degradation 事实的投影，而不是 UI 本地重建
