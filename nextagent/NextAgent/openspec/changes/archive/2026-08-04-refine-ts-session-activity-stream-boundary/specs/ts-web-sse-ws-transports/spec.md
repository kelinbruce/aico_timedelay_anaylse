## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 等价 Web Stream Transport
TS Web channel MUST 在同一明确流类型内提供等价的 SSE 和 WebSocket transport。

对于 Request Execution Stream，两种 transport MUST 使用核心契约定义的同一 `StreamEnvelope`、同一 `StreamEventType`、同一 session-scoped sequence、同一 terminal event 语义、同一 safe error boundary 和同一 redaction policy，并且 MUST 复用 `add-ts-run-status-visibility` owning 的共享 projection service。Transport 选择 MUST NOT 改变 runtime lifecycle、RequestRun status、canonical timeline、latest-request 规则、`RuntimeSessionPort.streamEvents(request)` 语义或 terminal commit 行为。

对于 `cross-session-activity-awareness` capability 定义的 Session Activity Projection Stream，两种 transport MUST 使用同一严格 activity message、同一 Owner Scope + Agent Scope、同一 snapshot-to-live 交接、同一失败关闭和无 cursor 重连语义。它们 MUST NOT 使用 `StreamEnvelope`、`StreamEventType`、timeline sequence、`RuntimeSessionPort.streamEvents(...)` 或 Request Execution Stream resume cursor，且 MUST 只注册在浏览器 ER surface；IR route whitelist MUST NOT 暴露 Activity SSE、Activity WebSocket 或 consume route。Request Execution Stream 与 Session Activity Projection Stream MUST 维持独立连接和独立协议状态；任一连接的建立、关闭、重连或失败 MUST NOT 建立、关闭、推进或清空另一类连接。

**需求类别**：功能性需求

#### Scenario: 同一请求的 SSE 和 WebSocket 输出等价
- **WHEN** 同一个 RequestRun 产生 canonical timeline events
- **THEN** SSE 和 WebSocket MUST 为 stream-visible events 投影相同的用户可见事件序列
- **AND** 两种 transport MUST 暴露相同的 terminal event type 和 safe failure 语义
- **AND** transport-specific framing、heartbeat 或 connection close 行为 MUST NOT 改变 `StreamEnvelope` payload 语义

#### Scenario: Transport 不拥有执行事实
- **WHEN** Web channel 通过 Request Execution Stream 发送 stream events
- **THEN** Web channel MUST 将 runtime timeline 或 runtime status 投影为 `StreamEnvelope`
- **AND** Web channel MUST NOT 创建私有 RequestRun status、私有 terminal state 或与 runtime 竞争的 lifecycle facts
- **AND** transport connection、disconnect 和 heartbeat diagnostics MUST NOT 被记录为 canonical execution timeline facts

#### Scenario: Session Activity 的 SSE 与 WebSocket 输出等价
- **WHEN** 同一可信 Owner Scope + Agent Scope 通过 SSE 或 WebSocket 打开 Session Activity Projection Stream
- **THEN** 两种 transport MUST 先发送语义相同的完整 activity snapshot，再发送语义相同的 session-keyed activity delta
- **AND** transport-specific framing、heartbeat 或 connection close 行为 MUST NOT 改变 activity message、scope 或消费语义
- **AND** 两种 transport MUST NOT 为 activity message 增加 Request Execution Stream 的 envelope、sequence、cursor、request filter 或 run filter

#### Scenario: 两类连接并存且互不驱动
- **WHEN** 同一浏览器 app instance 同时保持一个 Session Activity Projection Stream 和当前会话的 Request Execution Stream
- **THEN** Activity 连接 MUST NOT 触发、替代或关闭当前会话的 execution stream
- **AND** 当前会话切换、execution stream resume 或单个 run terminal MUST NOT 重建或完成全 scope Activity 连接
- **AND** 任一连接失败 MUST 只按自身协议恢复，MUST NOT 清空或伪造另一类流的客户端状态

#### Scenario: 非 Activity 的私有 Stream 不获得例外
- **WHEN** Web channel 尝试通过 SSE 或 WebSocket 投影既不属于 Request Execution Stream、也不属于 Session Activity Projection Stream 的用户可见状态
- **THEN** 系统 MUST NOT 把该状态作为新的私有 stream family 发送
- **AND** 新 stream family MUST 先通过独立 OpenSpec contract refinement 获得授权

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统提供两类边界清晰的 Web stream：会话执行流继续呈现单个会话、请求或 run 的执行过程；跨会话活动流只呈现可信范围内各会话当前需要用户注意的状态，两类流互不替代。
- **依据 Requirements**：`等价 Web Stream Transport`

### 输出

- **变更类型**：修改
- **目标内容**：Request Execution Stream 通过 SSE 或 WebSocket 输出等价的执行事件；Session Activity Projection Stream 通过 SSE 或 WebSocket 输出等价的活动快照和增量。两类输出不共享 payload、游标或恢复状态。
- **依据 Requirements**：`等价 Web Stream Transport`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先按输出语义判定流类型，再在该类型内执行相同的 scope 校验、SSE/WS 投影和失败恢复；未知第三类用户可见 stream 必须先获得独立规范授权。
- **依据 Requirements**：`等价 Web Stream Transport`

### 结果

- **变更类型**：修改
- **目标内容**：两种 transport 在同一流类型内产生等价结果；两类连接可并存并独立失败或恢复；未经授权的私有 stream 被拒绝。
- **依据 Requirements**：`等价 Web Stream Transport`

### 接口

- **变更类型**：修改
- **目标内容**：既有 session-scoped SSE/WebSocket 接口继续承载 Request Execution Stream；`cross-session-activity-awareness` 定义的 ER-only activity SSE/WebSocket 承载 Session Activity Projection Stream。
- **依据 Requirements**：`等价 Web Stream Transport`

### 主规格

- **变更类型**：修改
- **目标内容**：`ts-web-sse-ws-transports`
- **依据 Requirements**：`等价 Web Stream Transport`

### 遗留规格

- **变更类型**：修改
- **目标内容**：移除 `ts-core-contracts` 的 legacy `Canonical Timeline And Stream Projection` Requirement；执行流等价性由本次 MODIFIED Requirement 承载，未变化的输入、timeline consumption、live-tail 和 optional cursor 语义继续由本主规格既有 Requirements 承载，canonical timeline 事实行为继续由 `ts-run-status-visibility` 承载。
- **依据 Requirements**：`等价 Web Stream Transport`
