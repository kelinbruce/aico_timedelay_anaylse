## ADDED Requirements

### Requirement: Restful SSE Stream Type

当 RESTFUL 节点的 inputs 中 `stream_type` 值为 `"sse"` 时，MUST 使用 SSE 流式模式执行 capability 调用。

#### Scenario: SSE 流式调用正常完成 (S1)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且 `api_name` 指向已注册的 CLIP subscribe capability
- **AND** 节点 inputs 包含 `api_name`、`stream_type: "sse"` 和其他 API 参数
- **THEN** capability invocation 使用 CLIP `subscribe` 原语发起调用，通过 `emitResultDelta` 逐帧接收 SSE 事件
- **AND** `api_response` 输出变量包含完整的 `{ events: [...], completion: { reason, eventCount } }` 聚合结构
- **AND** 流式中间事件通过 `NODE_OUTPUT_DELTA` 实时上报（投影为 `TOOL_STRUCTURED_DELTA` LIVE_ONLY）
- **AND** 最终聚合结果通过 `CAPABILITY_RESULT_DELTA`（LIVE_ONLY）实时投递，并经 `TOOL_STRUCTURED_DELTA`（PERSISTED，`NODE_COMPLETED` 携带完整输出内容）持久化到 timeline store
- **AND** `CAPABILITY_COMPLETED` 保持 body-free（timeline 持久化策略拒绝携带可恢复内容）

#### Scenario: SSE 流式调用中途取消 (S2)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且调用过程中 `AbortSignal` 触发
- **THEN** capability invocation 被中止，CLIP sandbox 进程终止
- **AND** 节点抛出 `WORKFLOW_INTERRUPTED` 错误
- **AND** 已接收的流式事件保留在 LIVE_ONLY 状态，不产生持久化结果

#### Scenario: SSE 流式调用超时 (S3)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且节点 `timeout` 字段配置的秒数到达
- **THEN** capability invocation 被中止，CLIP sandbox 进程终止
- **AND** 节点抛出 timeout 错误
- **AND** 已接收的流式事件保留在 LIVE_ONLY 状态，不产生持久化结果

### Requirement: Restful SSE Mutual Exclusion

RESTFUL 节点的 `stream_type`、`batchInputDataItem`（批处理）和 `is_long_api`（长轮询）MUST 互斥。任两个或以上同时配置时，MUST 抛出 `WORKFLOW_NODE_INPUT_INVALID` 错误。

#### Scenario: SSE 与批处理互斥 (M1)

- **WHEN** RESTFUL 节点同时配置 `stream_type: "sse"` 和 `batchInputDataItem`（非空数组）
- **THEN** 节点执行前校验失败，抛出 `WORKFLOW_NODE_INPUT_INVALID` 错误
- **AND** `safeDetails.field` 包含冲突字段名
- **AND** 无 capability 调用发生

#### Scenario: SSE 与长轮询互斥 (M2)

- **WHEN** RESTFUL 节点同时配置 `stream_type: "sse"` 和 `is_long_api: true`
- **THEN** 节点执行前校验失败，抛出 `WORKFLOW_NODE_INPUT_INVALID` 错误
- **AND** `safeDetails.field` 包含冲突字段名
- **AND** 无 capability 调用发生

#### Scenario: 仅 SSE 配置正常执行 (M3)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且未配置 `batchInputDataItem` 和 `is_long_api`
- **THEN** 正常进入 SSE 流式执行路径
- **AND** `api_response` 包含聚合结果

### Requirement: Restful SSE Stream Delta Emission

SSE 流式调用过程中，每个到达的 SSE 事件 MUST 通过 `context.emitOutputDelta` 实时上报为 `NODE_OUTPUT_DELTA` 事件。

#### Scenario: 逐事件上报 (D1)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且 CLIP subscribe 连接建立
- **AND** CLIP sandbox 逐帧输出 SSE 事件
- **THEN** 每个解析后的 SSE 事件触发 `context.emitOutputDelta({ channel: "DSL", content: <event_json>, level: "DETAIL" })`
- **AND** WorkflowEngine 产生 `NODE_OUTPUT_DELTA` 事件，投影为 `TOOL_STRUCTURED_DELTA`（LIVE_ONLY）
- **AND** 实时事件流可被前端订阅和展示

#### Scenario: 无 emitResultDelta 时降级 (D2)

- **WHEN** capability invocation 的 `CapabilityInvocationRuntimeContext` 未提供 `emitResultDelta`
- **AND** CLIP subscribe 连接建立，SSE 事件到达
- **THEN** CLIP 层正常执行但不产生流式 delta
- **AND** 最终结果仍可聚合，`api_response` 包含完整的 `{ events, completion }` 结构
- **AND** 无实时流式展示，仅最终结果持久化

### Requirement: Restful SSE Aggregated Result

SSE 流式调用完成后，MUST 将 CLIP 层聚合的完整结果作为 `api_response` 输出变量传递给下游节点。

#### Scenario: 正常聚合结果 (A1)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且 CLIP subscribe 正常完成
- **AND** CLIP 层返回 `CapabilityInvocationResult`，`structuredPayload` 包含 `{ events: [...], completion: {...} }`
- **THEN** `capabilityResultPayload()` 提取 `structuredPayload` 作为 `api_response`，`NODE_COMPLETED` 携带 `output: { api_response, invocation_trace }` 进入投影路径
- **AND** 下游节点可通过 `${api_response.events}` 和 `${api_response.completion}` 访问聚合结果
- **AND** 聚合结果通过两条路径持久化/投递：
  - Timeline store：`TOOL_STRUCTURED_DELTA`（PERSISTED，`NODE_COMPLETED` 携带序列化聚合结果）
  - Live stream：`CAPABILITY_RESULT_DELTA`（LIVE_ONLY，`result: { api_response, invocation_trace }`）

#### Scenario: CLIP 调用失败 (A2)

- **WHEN** RESTFUL 节点配置 `stream_type: "sse"` 且 CLIP subscribe 返回 `FAILED` 或 `TIMED_OUT`
- **THEN** `capabilityResultPayload()` 抛出 `AgentError`，节点抛出对应错误
- **AND** `safeDetails` 包含 CLIP 层的错误信息
- **AND** 无部分结果持久化；`NODE_FAILED` 投影为 `CAPABILITY_COMPLETED`（FAILED/TIMED_OUT），不携带 output

### Requirement: Restful SSE Non-Streaming Compatibility

当 RESTFUL 节点未配置 `stream_type` 或 `stream_type` 不为 `"sse"` 时，MUST 保持现有行为不变。

#### Scenario: 默认行为不变 (N1)

- **WHEN** RESTFUL 节点无 `stream_type` 字段，inputs 包含 `api_name` 和其他参数
- **THEN** 进入现有执行路径（同步调用、长轮询或批处理）
- **AND** `api_response` 包含同步调用结果
- **AND** 无新增事件类型或投影行为

#### Scenario: stream_type 未知值处理 (N2)

- **WHEN** RESTFUL 节点配置 `stream_type: "unknown"`
- **THEN** 抛出 `WORKFLOW_NODE_INPUT_INVALID` 错误
- **AND** `safeDetails.field` 包含 `stream_type`
- **AND** 无 capability 调用发生
