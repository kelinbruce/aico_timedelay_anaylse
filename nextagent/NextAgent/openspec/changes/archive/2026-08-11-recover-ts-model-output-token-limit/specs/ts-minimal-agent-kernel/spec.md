## MODIFIED Requirements

### Requirement: 输出超限不得静默截断

当 provider 以 provider-neutral `finishReason="length"` 明确表示一次模型调用耗尽输出 Token 预算时，系统 SHALL 把该结果视为可恢复的不完整输出，不得直接提交 terminal success，也不得执行该结果携带的 Tool call。Agent core MUST 先尝试一次同请求预算提升；若提升后的纯文本结果仍为 `length`，MUST 在同一 request run 内最多发起 3 次 request-local 续写。只有恢复调用以非 `length` 正常结束且满足既有 terminal output guard 时，系统才可提交拼接后的最终回答。

同请求预算提升 MUST 复用同一模型路由、消息、工具集合、provider-neutral options、timeout 和 cancellation signal，只覆盖 `maxOutputTokens`。提升值 MUST 为原有效值的 8 倍且不超过 `32000 tokens`；同时 MUST 不超过基于当前模型 `contextWindowTokens` 与本次调用可得输入估算计算出的剩余输出窗口。原请求未显式设置 `maxOutputTokens` 时，候选提升值 MUST 为 `32000 tokens`。只有计算结果严格大于原有效值时才发起该次提升重试。

每次续写 MUST 把上一段 assistant 文本和一条隐藏的直接续写指令追加到本次恢复调用的 request-local 消息中，MUST 要求模型直接从截断处继续且不得道歉或复述；中间 assistant 文本和恢复指令 MUST NOT 作为独立 session message 持久化。续写段 MUST 按生成顺序拼接，恢复计数 MUST 以当前 model round 为边界且不得占用 Tool round 预算。

当第 3 次续写仍返回 `length`、任一 `length` 结果携带 Tool call，或恢复阶段产生无法安全接续的 Tool call 时，系统 MUST 发布不含原始输出的 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。direct model 可见文本硬上限 MUST 为 `150000` 个 UTF-16 code unit，并继续作为独立于输出 Token 恢复的容量保护。

当一次 direct model route 的累计 provider-neutral 可见文本首次超过 `150000` 个 UTF-16 code unit 时，系统 MUST 立即停止继续消费该模型输出，MUST 发布恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`，且 MUST NOT 启动该 route 的 Token 恢复、cross-model fallback 或执行模型返回的 Tool call。系统 MUST 从已接收的累计文本中保留顺序前缀且 MUST NOT 拆分 UTF-16 surrogate pair，必要时闭合末尾未闭合的 Markdown code fence 或 table row，追加固定标记 `[Model output truncated at the 150000-character safety limit.]`，并把总长不超过 `150000` 个 UTF-16 code unit 的结果作为唯一 terminal assistant message 提交；请求 MUST 以 `REQUEST_COMPLETED` 结束。超过容量的后缀和未完整形成的 Tool call MUST NOT 进入 stream 或 history，降级事件、SafeError、audit 和日志 MUST NOT 包含任何模型文本。

当 model delta、capability result 或 terminal assistant message 超过对应 persistence 或 stream 硬安全大小限制时，系统 MUST NOT 静默截断用户可见内容。除 read capability 明确返回 `truncated=true` 与 `nextOffset` 的逐行有界切片、上述 provider `length` 恢复流程，以及 direct model `150000` 个 UTF-16 code unit 上限的带固定标记有界交付外，Runtime、Agent core 或对应 boundary MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。任何超限与恢复处理 MUST NOT 把 raw prompt、provider-native raw output、Tool result、附件内容、credential、未脱敏路径或超过已声明容量的模型文本后缀写入 SafeError、stream、history、audit 或日志。

#### Scenario: 首次 Token 超限提升预算后完成

- **GIVEN** 当前模型请求的有效 `maxOutputTokens` 为 `2048`
- **WHEN** provider 返回纯文本结果且 `finishReason="length"`
- **THEN** Agent core MUST NOT 提交该截断结果
- **AND** MUST 使用相同请求输入把 `maxOutputTokens` 提升为 `16384` 后重试一次
- **AND** 当重试以 `finishReason="stop"` 完成时，系统 MUST 只提交重试得到的完整回答

#### Scenario: 提升预算后最多续写三次

- **GIVEN** 同请求预算提升后的纯文本结果仍为 `finishReason="length"`
- **WHEN** 后续恢复调用在第 1 次或第 2 次续写后仍返回 `length`，并在不超过第 3 次续写时正常完成
- **THEN** 每次续写 MUST 看到此前已生成的 assistant 段和隐藏续写指令
- **AND** 用户可见最终回答 MUST 按顺序包含各段内容且不包含隐藏续写指令
- **AND** 中间恢复消息 MUST NOT 作为独立 session message 持久化

#### Scenario: 三次续写后仍超限则安全失败

- **WHEN** 提升预算后的结果与随后 3 次续写结果均为 `finishReason="length"`
- **THEN** 系统 MUST 发布 `DEGRADATION_NOTICE`，reason code 为 `MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED`
- **AND** MUST 以 safe `REQUEST_FAILED` 结束
- **AND** MUST NOT 把任一截断段提交为 terminal assistant message

#### Scenario: 恢复链中的 Tool call 不得执行

- **WHEN** 首次或预算提升调用返回 `finishReason="length"` 且携带一个或多个 Tool call，或者任一 continuation 调用返回 Tool call
- **THEN** 系统 MUST NOT 执行这些缺少完整、可持久化恢复上下文的 Tool call
- **AND** 首次调用的 `length` Tool call 只允许通过同请求预算提升重新生成一次
- **AND** 若预算提升仍返回 `length` Tool call，或 continuation 调用返回任何 Tool call，系统 MUST 以 safe `REQUEST_FAILED` 结束

#### Scenario: 取消中止恢复链

- **WHEN** 当前 request 的 `AbortSignal` 在预算提升或续写期间被取消
- **THEN** 当前模型调用 MUST 被取消
- **AND** 系统 MUST NOT 发起后续恢复调用或提交 late output

#### Scenario: 硬字符上限保留有界内容

- **WHEN** 单次或拼接后的 direct model 可见文本超过 `150000` 个 UTF-16 code unit
- **THEN** 系统 MUST 发布恰好一次 code 为 `MODEL_TEXT_LIMIT_EXCEEDED` 的 `DEGRADATION_NOTICE`
- **AND** MUST 停止继续消费该模型输出，不得通过增加续写次数或 fallback 绕过硬上限
- **AND** MUST 提交按 Requirement 规则形成、以固定截断标记结尾且总长不超过 `150000` 个 UTF-16 code unit 的唯一 assistant message
- **AND** request MUST 以 `REQUEST_COMPLETED` 结束
- **AND** 超出容量的后缀和未完整形成的 Tool call MUST NOT 进入 stream 或 history

#### Scenario: 硬字符上限边界不触发降级

- **WHEN** direct model 可见文本总长恰好为 `150000` 个 UTF-16 code unit
- **THEN** 系统 MUST 原样提交该文本
- **AND** MUST NOT 发布 `MODEL_TEXT_LIMIT_EXCEEDED` 降级事件
