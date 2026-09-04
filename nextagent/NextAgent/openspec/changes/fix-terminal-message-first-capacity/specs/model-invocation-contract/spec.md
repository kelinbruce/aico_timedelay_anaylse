## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Failure exits are explicit and safe

模型调用不能产生成功终态时，MUST 通过 `ModelFinalResult.safeError` 返回显式安全失败。模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前把 `finishReason="content-filter"` 映射为 `category="POLICY_DENIED"`、`retryable=false` 的安全失败，并移除该终态携带的 content、reasoning、Tool calls 和 `incompleteOutputReason`；它 MUST 把没有 `safeError` 的 `finishReason="error"` 映射为没有 recoverability 证据的 non-retryable 安全失败。没有 Tool call 的 `finishReason="unknown"`，以及没有完整 Tool call 且未携带精确 `incompleteOutputReason="truncated-tool-call"` 证据的 `finishReason="tool-calls"`，MUST 同样安全失败。只有 `finishReason="tool-calls"`、没有完整 Tool call 且 provider 适配层已按 usage 证据标记 `incompleteOutputReason="truncated-tool-call"` 的结果，模型边界 MUST 原样保留其 incomplete 终态且不得增加 `safeError`，交由 Agent core 按 `模型输出超限执行受控恢复与有界交付` 处理。已有 `safeError` 的 error 终态 MUST 保留其可信 recoverability classification，并 MUST NOT 同时携带 `incompleteOutputReason`。模型边界 MUST NOT 暴露 raw provider result、error、endpoint、credential、header、custom fetch 或内部 lifecycle coordinates，也 MUST NOT 在内部切换模型。usage 缺失、不支持或单个 usage 字段非法不属于模型调用失败；但系统 MUST NOT 因 usage 缺失、部分非法或未达到有效输出预算而推断 `truncated-tool-call`。本 Requirement 不修改 `finishReason="length"` 的恢复顺序。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Provider 调用失败
- **WHEN** provider execution 失败
- **THEN** 终态结果携带安全失败
- **AND** 模型边界不调用其他模型
- **AND** 终态 MUST NOT 携带 `incompleteOutputReason`

#### Scenario: 具有精确截断证据的空 Tool-call 终态进入恢复
- **WHEN** provider 适配层返回 `finishReason="tool-calls"`、无完整 Tool call 且 `incompleteOutputReason="truncated-tool-call"`
- **THEN** 模型边界 MUST 原样保留该 incomplete 终态且 MUST NOT 增加 `safeError`
- **AND** Agent core MUST 按 `模型输出超限执行受控恢复与有界交付` 处理该结果

#### Scenario: 缺少或使用错误截断证据的空 Tool-call 终态安全失败
- **WHEN** provider 返回 `finishReason="tool-calls"` 且没有完整 Tool call
- **AND** `incompleteOutputReason` 缺失或不等于 `truncated-tool-call`
- **THEN** 模型边界 MUST 返回 non-retryable `MODEL_TOOL_CALLS_MISSING`
- **AND** `AFTER_MODEL_RESULT` hook、Tool 执行和 terminal success MUST NOT 启动

#### Scenario: Provider content filter 阻断终态
- **WHEN** provider 返回 `finishReason="content-filter"`，无论该结果是否同时携带 content、reasoning、Tool calls 或输出预算证据
- **THEN** 模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前返回 non-retryable `POLICY_DENIED` 安全失败
- **AND** 失败终态 MUST NOT 交付 content、reasoning、Tool calls 或 `incompleteOutputReason`

#### Scenario: Error 终态没有 recoverability 证据
- **WHEN** provider 返回 `finishReason="error"` 且没有 `safeError`
- **THEN** 模型边界 MUST 返回 non-retryable 安全失败
- **AND** Agent Core MUST NOT 仅按 error category 或输出 Token 数推断可恢复输出

#### Scenario: 结束原因与结果不完整但没有截断证据
- **WHEN** provider 返回没有完整 Tool call 的 `finishReason="tool-calls"`、`stop` 或 `unknown`，且 usage 缺失、部分非法或 `outputTokens` 小于本次有效 `maxOutputTokens`
- **THEN** 模型边界 MUST 返回 non-retryable 安全失败
- **AND** `AFTER_MODEL_RESULT` hook、输出恢复、Tool 执行和 terminal success MUST NOT 启动

#### Scenario: 只有 usage 不完整
- **WHEN** provider output 可安全归一化，但 usage 缺失或部分非法
- **THEN** 模型调用保持成功
- **AND** 终态只省略不可用 usage 字段

## REMOVED Requirements

### Requirement: 输出超限不得静默截断

**Reason**：该 legacy Requirement 同时承载 `FN-4.1` 模型输出恢复、`FN-4.5` Capability 大结果外置、`FN-8.1` terminal Message/Event 容量保护和 `FN-4.6` read 分页行为。本 change 实质修改其模型字符上限、Capability 外置例外与 terminal guard，继续完整重述会违反一个 Requirement 归属一个 Function/spec 的治理规则。

**Migration**：模型输出恢复和 50,000 字符有界交付无损迁入本 spec 新增的 `模型输出超限执行受控恢复与有界交付`；Capability 外置迁入 `large-content-references / Capability-result large content is externalized to the execution workspace as a readable file`；terminal guard 迁入 `gateway-store-provider-ownership / 终态复合提交使用唯一Message正文` 与 `终态timeline Event在复合提交前保持有界`；read 分页迁入 `large-content-readback / Model can read back externalized tool results via the workspace file path with bounded pages`。四个目标共同保留原 Requirement 的目标态行为，其他 stable Requirements 原位保留。

## ADDED Requirements

### Requirement: 模型输出超限执行受控恢复与有界交付

当模型终态携带 `incompleteOutputReason` 时，系统 MUST 把该结果视为可恢复的不完整输出，不得直接提交 terminal success，也不得执行该结果携带或尚未完整形成的 Tool call。模型边界 MUST 对没有结构残缺 Tool call 的 `finishReason="length"` 输出设置 `incompleteOutputReason="output-limit"`。当 Tool call 结构残缺时，模型边界仅在以下任一条件成立时 MUST 设置 `incompleteOutputReason="truncated-tool-call"`：provider-neutral `finishReason="length"`；或者 `finishReason` 为 `tool-calls | stop | unknown`，且合法 `usage.outputTokens` 不小于本次有效 `maxOutputTokens`。后一个比较 MUST 使用整数 Token 值且不设置容差；不满足任何条件时 MUST 按 `Failure exits are explicit and safe` 返回安全失败。`content-filter`、`error` 和已有 `safeError` MUST 优先于上述推断且不得携带 `incompleteOutputReason`。

Agent core MUST 依据 `incompleteOutputReason` 而不是 `finishReason` 进入唯一输出恢复流程。没有可见 content、没有 Tool call、存在非空 reasoning、携带 `incompleteOutputReason="output-limit"` 且没有 `safeError` 的终态 MUST 被识别为 reasoning-only 输出耗尽。当前 model round 首次出现 reasoning-only 输出耗尽时，Agent core MUST 在保持本次有效 `maxOutputTokens` 不变的情况下，注入一次 request-local reasoning-only 收敛指令并重试；MUST NOT 在该收敛重试前提升输出预算。该指令 MUST 要求模型立即返回简洁的用户可见回答或一次必要 Tool call，MUST NOT 要求或重复内部推理。该收敛重试在当前 model round 内 MUST 至多发生一次，且收敛指令 MUST NOT 作为独立 session message 持久化。

收敛重试没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统 MUST 正常提交完整回答或执行完整 Tool call。收敛重试转为带非空可见 content、没有 Tool call 的 `incompleteOutputReason="output-limit"` 时，系统 MUST 按普通 `output-limit` 从一次同请求预算提升开始恢复。收敛重试再次形成 reasoning-only 输出耗尽时，当前 route MUST 以既有 retryable `MODEL_EMPTY_OUTPUT` 安全失败进入 cross-model fallback；该 route MUST NOT 再提升输出预算、发起 continuation 或提交空终态。没有可用 fallback 或 fallback 耗尽时，请求 MUST 以安全失败结束。

除 reasoning-only 输出耗尽外，Agent core MUST 先对 `incompleteOutputReason` 尝试一次同请求预算提升。`incompleteOutputReason="output-limit"` 的预算提升结果仍为带非空可见 content、没有 Tool call 的 `output-limit` 时，系统 MUST 在同一 request run 内最多发起 3 次 request-local 续写。`incompleteOutputReason="truncated-tool-call"` 只允许同请求预算提升重新生成一次；预算提升后仍有任一 `incompleteOutputReason` 时 MUST 安全失败，不得把残缺 Tool call 转成文本续写。只有恢复调用没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统才可提交最终回答或执行完整 Tool call。

同请求预算提升 MUST 复用同一模型路由、消息、工具集合、provider-neutral options、timeout 和 cancellation signal，只覆盖 `maxOutputTokens`。提升值 MUST 为原有效值的 8 倍且不超过 `32000 tokens`；同时 MUST 不超过基于当前模型 `contextWindowTokens` 与本次调用可得输入估算计算出的剩余输出窗口。原请求未显式设置 `maxOutputTokens` 时，候选提升值 MUST 为 `32000 tokens`。只有计算结果严格大于原有效值时才发起该次提升重试。

每次续写 MUST 把上一段 assistant 文本和一条隐藏的直接续写指令追加到本次恢复调用的 request-local 消息中，MUST 要求模型直接从截断处继续且不得道歉或复述；中间 assistant 文本和恢复指令 MUST NOT 作为独立 session message 持久化。续写段 MUST 按生成顺序拼接，恢复计数 MUST 以当前 model round 为边界且不得占用 Tool round 预算。

当第 3 次续写仍返回 `output-limit`、任一 `output-limit` 结果携带完整或残缺 Tool call，或恢复阶段产生无法安全接续的 Tool call 时，系统 MUST 发布不含原始输出的 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。direct model 可见文本硬上限 MUST 为 `50000` 个 UTF-16 code unit，并继续作为独立于输出 Token 恢复的容量保护。

当一次 direct model route 的累计 provider-neutral 可见文本首次超过 `50000` 个 UTF-16 code unit 时，系统 MUST 立即停止继续消费该模型输出，MUST 发布恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`，且 MUST NOT 启动该 route 的 Token 恢复、cross-model fallback 或执行模型返回的 Tool call。系统 MUST 从已接收的累计文本中保留顺序前缀且 MUST NOT 拆分 UTF-16 surrogate pair；当保留前缀以未闭合的 Markdown code fence 或 table row 结束时，系统 MUST 闭合该结构；随后 MUST 追加固定标记 `[Model output truncated at the 50000-character safety limit.]`，并把总长不超过 `50000` 个 UTF-16 code unit 的结果作为唯一 terminal assistant message 提交；请求 MUST 以 `REQUEST_COMPLETED` 结束。超过容量的后缀和未完整形成的 Tool call MUST NOT 进入 stream 或 history，降级事件、SafeError、audit 和日志 MUST NOT 包含任何模型文本。

模型输出恢复和字符容量处理 MUST NOT 静默省略已接受的可见文本，也 MUST NOT 把 raw prompt、provider-native raw output、作为模型输入的 Tool result 或附件内容、credential、未脱敏路径或超过 50,000 字符边界的模型文本后缀写入 SafeError、stream、history、audit 或日志。除上述 provider 输出恢复流程和 direct model 50,000 个 UTF-16 code unit 上限的带固定标记有界交付外，模型边界与 Agent core MUST 对无法安全恢复或提交的模型输出发布不含原始输出的 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。

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

#### Scenario: 字符上限边界保持原样

- **WHEN** 单次或拼接后的 direct model 可见文本恰好为 `50000` 个 UTF-16 code unit
- **THEN**系统 MUST 原样提交唯一 assistant message 并以 `REQUEST_COMPLETED` 结束
- **AND** MUST NOT 发布 `MODEL_TEXT_LIMIT_EXCEEDED`

#### Scenario: 硬字符上限保留有界内容

- **WHEN** 单次或拼接后的 direct model 可见文本超过 `50000` 个 UTF-16 code unit
- **THEN** 系统 MUST 发布恰好一次 code 为 `MODEL_TEXT_LIMIT_EXCEEDED` 的 `DEGRADATION_NOTICE`
- **AND** MUST 停止继续消费该模型输出，不得通过恢复或 fallback 绕过硬上限
- **AND** MUST 提交按 Requirement 规则形成、以固定截断标记结尾且总长不超过 `50000` 个 UTF-16 code unit 的唯一 assistant message
- **AND**请求 MUST 以 `REQUEST_COMPLETED` 结束

## Function 变更汇总

### 结果

- **变更类型**：修改
- **目标内容**：direct model 超过 Gateway 可提交边界时保留有界有效前缀、追加固定标记并成功完成；绕过 producer 保护的超限 terminal 正文仍由 Runtime 安全拒绝。
- **依据 Requirements**：`Failure exits are explicit and safe`、`模型输出超限执行受控恢复与有界交付`

### 规格

- **规格项**：direct model 可见文本硬上限
- **变更类型**：修改
- **原规格值**：`150000` 个 UTF-16 code unit，超限后带标记有界交付并完成
- **目标规格值**：`50000` 个 UTF-16 code unit，恰好边界原样完成，超限后带标记有界交付并完成
- **依据 Requirements**：`模型输出超限执行受控恢复与有界交付`
