## ADDED Requirements

### Requirement: Terminal assistant 输出必须非空

当 request 以状态 `COMPLETED` 到达 terminal commit 时，terminal assistant content SHALL 是非空、非纯空白的字符串。

在 terminal readiness 之前，若某次模型结果没有 tool call，且可见 assistant content 为空或仅含空白，该结果 MUST 进入有界的 model-output recovery。若该 recovery 被耗尽，Agent Core MUST 发出 code 为 `MODEL_EMPTY_OUTPUT` 的 `DEGRADATION_NOTICE` 并让 run 安全失败，而不是输出最终内容或允许 completed terminal commit。

若空或仅含空白的 assistant 结果在 model-output recovery 之后到达 Agent Core 的 terminal-readiness 边界，Agent Core MUST 发出 code 为 `MODEL_FINAL_CONTENT_EMPTY` 的 `DEGRADATION_NOTICE` 并让 run 安全失败。

Runtime terminal commit MUST 以防御方式把任何 assistant content 为空或仅含空白的 `COMPLETED` terminal commit 转换为安全的 `FAILED`，发出 code 为 `MODEL_FINAL_CONTENT_EMPTY` 的 `DEGRADATION_NOTICE`，并持久化一条非空的安全 assistant 失败消息。

`Rag`、memory search 或其他只读 tool 返回零检索结果，其自身 MUST NOT 导致 request 失败。失败条件是 tool 处理之后模型的空 terminal assistant 输出。

当模型返回 `finishReason="stop"`、非空 reasoning、当前 model route 中任何位置都没有可见 assistant content、没有 tool call 且没有 safe error 时，Agent Core MUST 在产生 `MODEL_EMPTY_OUTPUT` 之前，在该 planning round 内恰好执行一次同模型纠正调用。该纠正调用 MUST 使用固定的受信 instruction，MUST NOT 把 reasoning 投影为可见 assistant content，并 MUST 保留既有的 cancellation、timeout、deadline、lifecycle-hook 和 model-routing 边界。

若纠正调用仍不产生可见内容或 tool call，Agent Core MUST 把该结果归类为 retryable `MODEL_EMPTY_OUTPUT`，并评估既有 model fallback policy。Fallback MUST 只在既有的 visible-output replay、cancellation、deadline、budget、route-availability 和 route-exhaustion guard 允许时发生。同一 planning round 内，fallback route MUST NOT 接收第二次 reasoning-only 纠正调用。

完全没有 reasoning 的空模型结果 MUST 直接进入 `MODEL_EMPTY_OUTPUT`，不消耗 reasoning-only 纠正调用。

#### Scenario: 模型以完全为空的输出 stop

- **GIVEN** 某个 model round 返回 `finishReason="stop"`、没有 reasoning、没有 tool call，且 assistant content 为空或仅含空白
- **WHEN** Agent Core 评估 model-output recovery
- **THEN** Agent Core MUST 把该结果归类为 retryable `MODEL_EMPTY_OUTPUT`，且不消耗 reasoning-only 纠正调用
- **AND** Agent Core MUST 评估既有 fallback policy
- **AND** 若 recovery 被耗尽，Agent Core MUST 发出 code 为 `MODEL_EMPTY_OUTPUT` 的 `DEGRADATION_NOTICE`
- **AND** request MUST 以 `REQUEST_FAILED` 结束
- **AND** request MUST NOT 发布 `REQUEST_COMPLETED`
- **AND** conversation history MUST 包含一条非空的安全 assistant 失败消息

#### Scenario: Runtime 阻止自定义 agent 提交空的 completed terminal commit

- **GIVEN** 某个 agent 实现绕过 Agent Core 输出 guard，尝试以空或仅含空白的内容提交 `COMPLETED` terminal commit
- **WHEN** Runtime 执行 terminal commit
- **THEN** Runtime MUST 发出 code 为 `MODEL_FINAL_CONTENT_EMPTY` 的 `DEGRADATION_NOTICE`
- **AND** Runtime MUST 持久化 `REQUEST_FAILED`，并附带一条非空的安全 assistant 失败消息

#### Scenario: Reasoning-only stop 被纠正一次

- **GIVEN** 某次模型调用返回 `finishReason="stop"`、非空 reasoning、没有可见内容且没有 tool call
- **WHEN** Agent Core 评估该模型结果
- **THEN** Agent Core MUST 以固定的纠正 instruction 对同一路由模型恰好调用一次
- **AND** 该纠正 request MUST NOT 把先前的 reasoning 作为可见内容包含
- **AND** 纠正调用产生的可见内容或 tool call MUST 沿普通 agent loop 继续

#### Scenario: 连续 reasoning-only stop 使用有条件 fallback

- **GIVEN** 初始调用及其唯一一次纠正调用都返回 reasoning-only 的 `finishReason="stop"` 结果
- **WHEN** Agent Core 耗尽 reasoning-only 纠正
- **THEN** Agent Core MUST 产生 retryable `MODEL_EMPTY_OUTPUT`
- **AND** Agent Core MUST 像处理其他 retryable 模型失败一样评估既有 fallback policy
- **AND** 当没有既有 fallback guard 拒绝时，符合条件的 fallback route MUST 被使用
- **AND** 当不存在符合条件的 fallback route 时，run MUST 显式以 `MODEL_EMPTY_OUTPUT` 失败
- **AND** 同一 planning round 内，任何 fallback route 都 MUST NOT 接收另一次 reasoning-only 纠正调用

#### Scenario: 带有 tool call 的 reasoning 不是语义空输出

- **GIVEN** 某次模型调用返回 reasoning 和至少一个 tool call
- **WHEN** Agent Core 评估该模型结果
- **THEN** Agent Core MUST 沿普通 tool loop 继续
- **AND** 它 MUST NOT 发起 reasoning-only 纠正调用

#### Scenario: 已确认的可见 continuation 不是语义空输出

- **GIVEN** output-token recovery 已在当前 model route 中确认了可见 assistant content
- **AND** 某次 continuation 调用返回 reasoning-only 的 `finishReason="stop"`
- **WHEN** Agent Core 评估该 continuation 结果
- **THEN** Agent Core MUST 保留已确认的可见内容
- **AND** 它 MUST NOT 发起 reasoning-only 纠正调用
- **AND** 它 MUST NOT 通过 model fallback 重放该 route
