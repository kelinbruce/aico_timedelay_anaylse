## ADDED Requirements

### Requirement: Guard-forward relay forwards the guard proxy stream to the client

当 REMOTE 部署启用护栏时，Web channel 的 request submit 路径（`POST /api/v1/sessions/:sessionId/requests`，`runtime.submit` 之前）SHALL 经 `GuardrailGatewayPort` 把 submit 请求转发到 RobotRouter guard proxy。RobotRouter 做输入校验后回调 NextAgent 既有 submit 端点触发 `runtime.submit` 执行 Agent，并代理该 run 的流（观察输出、可注入 terminal `OUTPUT_GUARD_BLOCKED`）。NextAgent SHALL 把 RobotRouter 返回的流经共享 projection service 投影给客户端（依 `refine-stream-guard-blocked-event` 的 guard-forward relay 例外）。调用 RobotRouter 的发起方始终是 NextAgent 后端；前端/客户端仍只与 NextAgent 自有端点交互。

guard-forward relay MUST 复用与直连 Agent 相同的 `StreamEnvelope` 契约、session-scoped sequence、terminal event 语义、safe error boundary 与 redaction policy。除 `OUTPUT_GUARD_BLOCKED`（依 refinement 例外）外，其他 stream event 仍 MUST 从 canonical timeline 或 runtime status 派生，projection service MUST NOT 发明其他 transport-private stream event 名。transport 选择（SSE 或 WebSocket）MUST NOT 改变 guard-forward 的 envelope 语义。未启用护栏时，submit 路径 MUST 保持既有直连 `runtime.submit` 行为不变，客户端流不经 guard-forward relay。

#### Scenario: Guard-forward relay projects the guard proxy stream

- **WHEN** 启用护栏的 REMOTE 部署在 submit 路径转发到 RobotRouter guard proxy
- **THEN** NextAgent MUST 把 RobotRouter 返回的流经共享 projection service 投影给客户端
- **AND** MUST NOT 维护 transport 私有 terminal 状态或私有映射表
- **AND** 除 `OUTPUT_GUARD_BLOCKED` 外其他事件 MUST 从 canonical timeline 或 runtime status 派生

#### Scenario: Disabled guardrail keeps direct dispatch

- **WHEN** 未启用护栏或 LOCAL 部署
- **THEN** submit 路径 MUST 保持既有直连 `runtime.submit` 的 stream 行为
- **AND** MUST NOT 走 guard-forward relay 路径

### Requirement: Output-guard block projects terminal OUTPUT_GUARD_BLOCKED via the relay

output-guard block 命中时，guard-forward relay SHALL 在客户端流投影 terminal `OUTPUT_GUARD_BLOCKED` stream event（依 `refine-stream-guard-blocked-event`），payload 携带 guard reason 与 RobotRouter 返回的 `refusalMessage`。`OUTPUT_GUARD_BLOCKED` 之后 MUST NOT 再投影 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`，且 MUST 以 terminal 语义结束本次请求流；MUST NOT 继续推送已缓冲的模型输出原文。前端产品路径收到 `OUTPUT_GUARD_BLOCKED` 后 MUST 只清空本轮已渲染的内容（不影响历史轮次展示）并替换为拒答语。被拦截轮次的 assistant 响应 MUST NOT 进入后续轮次的 model context（见 guardrail-gateway spec "A blocked round is excluded from model-visible history"）。SSE 与 WebSocket transport 对该 terminal 行为 MUST 表现等价。本 change 不再使用 `failRun`/run FAILED/`REQUEST_FAILED` 映射路线（已撤除）。

#### Scenario: Output-guard block projects terminal OUTPUT_GUARD_BLOCKED

- **WHEN** RobotRouter 发出 output-guard-block 信号
- **THEN** guard-forward relay MUST 投影 terminal `OUTPUT_GUARD_BLOCKED` 事件，payload 携带 guard reason 与 `refusalMessage`
- **AND** 该 terminal 事件之后 MUST NOT 出现增量内容事件
- **AND** 前端 MUST 只清空本轮已渲染内容并替换为拒答语，历史轮次展示不受影响

#### Scenario: Output-guard block does not leak buffered output

- **WHEN** output-guard-block 发生时已缓冲未推送的模型输出
- **THEN** guard-forward relay MUST NOT 在该 terminal 事件后推送已缓冲的模型输出原文
- **AND** 拒答 payload MUST 只含 RobotRouter 返回的 `refusalMessage`
