## Function

- **所属 Function**：`FN-4.1 调用模型`（model-invocation-contract）
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 输出超限不得静默截断

当模型终态携带 `incompleteOutputReason` 时，系统 MUST 把该结果视为可恢复的不完整输出，不得直接提交 terminal success，也不得执行该结果携带或尚未完整形成的 Tool call。模型边界 MUST 对没有结构残缺 Tool call 的 `finishReason="length"` 输出设置 `incompleteOutputReason="output-limit"`。当 Tool call 结构残缺时，模型边界仅在以下任一条件成立时 MUST 设置 `incompleteOutputReason="truncated-tool-call"`：provider-neutral `finishReason="length"`；或者 `finishReason` 为 `tool-calls | stop | unknown`，且合法 `usage.outputTokens` 不小于本次有效 `maxOutputTokens`。后一个比较 MUST 使用整数 Token 值且不设置容差；不满足任何条件时 MUST 按 `Failure exits are explicit and safe` 返回安全失败。`content-filter`、`error` 和已有 `safeError` MUST 优先于上述推断且不得携带 `incompleteOutputReason`。

Agent core MUST 依据 `incompleteOutputReason` 而不是 `finishReason` 进入唯一输出恢复流程。没有可见 content、没有 Tool call、存在非空 reasoning、携带 `incompleteOutputReason="output-limit"` 且没有 `safeError` 的终态 MUST 被识别为 reasoning-only 输出耗尽。当前 model round 首次出现 reasoning-only 输出耗尽时，Agent core MUST 在保持本次有效 `maxOutputTokens` 不变的情况下，注入一次 request-local reasoning-only 收敛指令并重试；MUST NOT 在该收敛重试前提升输出预算。该指令 MUST 要求模型立即返回简洁的用户可见回答或一次必要 Tool call，MUST NOT 要求或重复内部推理。该收敛重试在当前 model round 内 MUST 至多发生一次，且收敛指令 MUST NOT 作为独立 session message 持久化。

收敛重试没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统 MUST 正常提交完整回答或执行完整 Tool call。收敛重试转为带非空可见 content、没有 Tool call 的 `incompleteOutputReason="output-limit"` 时，系统 MUST 按普通 `output-limit` 从一次同请求预算提升开始恢复。收敛重试再次形成 reasoning-only 输出耗尽时，当前 route MUST 以既有 retryable `MODEL_EMPTY_OUTPUT` 安全失败进入 cross-model fallback；该 route MUST NOT 再提升输出预算、发起 continuation 或提交空终态。没有可用 fallback 或 fallback 耗尽时，请求 MUST 以安全失败结束。

除 reasoning-only 输出耗尽外，Agent core MUST 先对 `incompleteOutputReason` 尝试一次同请求预算提升。`incompleteOutputReason="output-limit"` 的预算提升结果仍为带非空可见 content、没有 Tool call 的 `output-limit` 时，系统 MUST 在同一 request run 内最多发起 3 次 request-local 续写。`incompleteOutputReason="truncated-tool-call"` 只允许同请求预算提升重新生成一次；预算提升后仍有任一 `incompleteOutputReason` 时 MUST 安全失败，不得把残缺 Tool call 转成文本续写。只有恢复调用没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统才可提交最终回答或执行完整 Tool call。

同请求预算提升 MUST 复用同一模型路由、消息、工具集合、provider-neutral options、timeout 和 cancellation signal，只覆盖 `maxOutputTokens`。提升值 MUST 为原有效值的 8 倍且不超过 `32000 tokens`；同时 MUST 不超过基于当前模型 `contextWindowTokens` 与本次调用可得输入估算计算出的剩余输出窗口。原请求未显式设置 `maxOutputTokens` 时，候选提升值 MUST 为 `32000 tokens`。只有计算结果严格大于原有效值时才发起该次提升重试。

每次续写 MUST 把上一段 assistant 文本和一条隐藏的直接续写指令追加到本次恢复调用的 request-local 消息中，MUST 要求模型直接从截断处继续且不得道歉或复述；中间 assistant 文本和恢复指令 MUST NOT 作为独立 session message 持久化。续写段 MUST 按生成顺序拼接，恢复计数 MUST 以当前 model round 为边界且不得占用 Tool round 预算。

当第 3 次续写仍返回 `output-limit`、任一 `output-limit` 结果携带完整或残缺 Tool call，或恢复阶段产生无法安全接续的 Tool call 时，系统 MUST 发布不含原始输出的 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。direct model 可见文本硬上限 MUST 为 `150000` 个 UTF-16 code unit，并继续作为独立于输出 Token 恢复的容量保护。

当一次 direct model route 的累计 provider-neutral 可见文本首次超过 `150000` 个 UTF-16 code unit 时，系统 MUST 立即停止继续消费该模型输出，MUST 发布恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`，且 MUST NOT 启动该 route 的 Token 恢复、cross-model fallback 或执行模型返回的 Tool call。系统 MUST 从已接收的累计文本中保留顺序前缀且 MUST NOT 拆分 UTF-16 surrogate pair；当保留前缀以未闭合的 Markdown code fence 或 table row 结束时，系统 MUST 闭合该结构；随后 MUST 追加固定标记 `[Model output truncated at the 150000-character safety limit.]`，并把总长不超过 `150000` 个 UTF-16 code unit 的结果作为唯一 terminal assistant message 提交；请求 MUST 以 `REQUEST_COMPLETED` 结束。超过容量的后缀和未完整形成的 Tool call MUST NOT 进入 stream 或 history，降级事件、SafeError、audit 和日志 MUST NOT 包含任何模型文本。

当 model delta、capability result 或 terminal assistant message 超过对应 persistence 或 stream 硬安全大小限制时，系统 MUST NOT 静默截断用户可见内容。除 read capability 明确返回 `truncated=true` 与 `nextOffset` 的逐行有界切片、上述 provider 输出恢复流程，以及 direct model `150000` 个 UTF-16 code unit 上限的带固定标记有界交付外，Runtime、Agent core 或对应 boundary MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。任何超限与恢复处理 MUST NOT 把 raw prompt、provider-native raw output、Tool result、附件内容、credential、未脱敏路径或超过已声明容量的模型文本后缀写入 SafeError、stream、history、audit 或日志。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复、安全、性能/容量
**适用范围**：该 Function

#### Scenario: 首次 reasoning-only 输出耗尽在原预算下收敛

- **GIVEN** 当前调用的有效 `maxOutputTokens` 为 `16384`
- **WHEN** 模型首次返回无 content、无 Tool call、reasoning 非空、`incompleteOutputReason="output-limit"` 且无 `safeError` 的终态
- **THEN** Agent core MUST 注入一次 reasoning-only 收敛指令并以 `maxOutputTokens=16384` 重试
- **AND** MUST NOT 在该重试前发起 `maxOutputTokens=32000` 的预算提升

#### Scenario: 收敛重试产出有效结果

- **WHEN** reasoning-only 收敛重试返回没有 `incompleteOutputReason` 和 `safeError` 的非空可见回答或完整 Tool call
- **THEN** 系统 MUST 只消费该完整结果
- **AND** MUST NOT 为当前 model round 再发起预算提升或 reasoning-only 收敛重试

#### Scenario: 收敛后转为普通可见文本超限

- **WHEN** reasoning-only 收敛重试返回非空可见 content、无 Tool call且 `incompleteOutputReason="output-limit"`
- **THEN** Agent core MUST 使用既有同请求规则尝试一次预算提升
- **AND** 预算提升后仍为可续写纯文本 `output-limit` 时 MUST 继续遵循最多 3 次 request-local 续写边界

#### Scenario: 收敛后再次 reasoning-only 耗尽

- **WHEN** reasoning-only 收敛重试再次返回无 content、无 Tool call、reasoning 非空、`incompleteOutputReason="output-limit"` 且无 `safeError`
- **THEN** 当前 route MUST 以 retryable `MODEL_EMPTY_OUTPUT` 安全失败进入既有 cross-model fallback
- **AND** 当前 route MUST NOT 提升输出预算、发起 continuation 或提交空终态
- **AND** 当前 model round MUST NOT 注入第二次 reasoning-only 收敛指令

#### Scenario: 普通文本超限保持先提升预算

- **GIVEN** 当前模型请求的有效 `maxOutputTokens` 为 `2048`
- **WHEN** 模型返回非空可见 content、无 Tool call且 `incompleteOutputReason="output-limit"`
- **THEN** Agent core MUST NOT 注入 reasoning-only 收敛指令
- **AND** MUST 使用相同请求输入把 `maxOutputTokens` 提升为 `16384` 后重试一次

#### Scenario: 残缺 Tool call 保持一次重生成

- **WHEN** 模型返回 `incompleteOutputReason="truncated-tool-call"`
- **THEN** Agent core MUST 只允许一次同请求预算提升重新生成
- **AND** 提升后仍有任一 `incompleteOutputReason` 时 MUST 安全失败且 MUST NOT 执行或续写残缺 Tool call

#### Scenario: 取消中止恢复链

- **WHEN** 当前 request 的 `AbortSignal` 在预算提升、reasoning-only 收敛重试、fallback 或续写期间被取消
- **THEN** 当前模型调用 MUST 被取消
- **AND** 系统 MUST NOT 发起后续恢复调用或提交 late output

#### Scenario: 硬字符上限保留有界内容

- **WHEN** 单次或拼接后的 direct model 可见文本超过 `150000` 个 UTF-16 code unit
- **THEN** 系统 MUST 发布恰好一次 code 为 `MODEL_TEXT_LIMIT_EXCEEDED` 的 `DEGRADATION_NOTICE`
- **AND** MUST 停止继续消费该模型输出，不得通过恢复或 fallback 绕过硬上限
- **AND** MUST 提交按 Requirement 规则形成、以固定截断标记结尾且总长不超过 `150000` 个 UTF-16 code unit 的唯一 assistant message

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统对 reasoning-only 输出耗尽先在原输出预算下执行至多一次收敛；收敛成功时消费完整结果，转为普通文本超限时进入既有预算提升与有界续写，再次耗尽时进入既有 fallback 或安全失败；其他不完整输出保持原恢复边界。
- **依据 Requirements**：`输出超限不得静默截断`

### 结果

- **变更类型**：修改
- **目标内容**：reasoning-only 发散不得通过先扩大输出预算放大耗时；恢复成功只交付完整回答或完整 Tool call，重复空耗尽、恢复耗尽与残缺 Tool call 均安全失败且不执行无效输出。
- **依据 Requirements**：`输出超限不得静默截断`

### 规格

- **规格项**：输出 Token 恢复
- **变更类型**：修改
- **原规格值**：所有 `output-limit` 首先执行一次同请求预算提升；预算提升后 reasoning-only 结果再执行至多一次收敛，普通纯文本超限最多续写 3 次
- **目标规格值**：reasoning-only `output-limit` 首先在原预算下收敛至多 1 次，重复耗尽直接进入 fallback 或安全失败；普通纯文本 `output-limit` 保持一次预算提升和最多 3 次续写，`truncated-tool-call` 保持一次预算提升
- **依据 Requirements**：`输出超限不得静默截断`
