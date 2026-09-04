## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Non-streaming and streaming invocation share one terminal result contract

非流式与流式调用 SHALL 收敛到相同 `ModelFinalResult` 语义。`ModelStreamDelta` 表示有序的 provider-neutral 增量事实，`ModelFinalResult` 表示唯一终态。`ModelFinalResult` MUST 为封闭对象：required field MUST 恰好为 `content`；optional fields MUST 恰好为 `reasoning`、`finishReason`、`incompleteOutputReason`、`usage`、`toolCalls`、`providerResponseId` 和 `safeError`。`incompleteOutputReason` 的类型 MUST 为 `ModelIncompleteOutputReason`，允许值 MUST 恰好为 `output-limit | truncated-tool-call`；字段缺失 MUST 表示系统没有可恢复的不完整输出证据，显式 `null` 和未知值 MUST 被拒绝。`incompleteOutputReason` 与 `finishReason` MUST 是独立事实：系统 MUST 保留 provider-neutral `finishReason`，不得为触发恢复而把 `tool-calls`、`stop` 或 `unknown` 改写为 `length`。

模型身份由对应 `ModelInvocationRequest.modelId` 拥有。provider 返回的 model identity 只作为边界内 normalization input；`providerResponseId` 只用于安全 response correlation。`complete()` MUST 使用 provider 支持的 native non-stream 调用，MUST NOT 聚合 `stream()`。`stream(request, signal, onDelta)` MUST 按顺序 `await` `onDelta` 交付零个或多个 `ModelStreamDelta`，并以 `Promise<ModelFinalResult>` 恰好返回一个终态；终态位置由该 Promise 的完成唯一确定，MUST NOT 把终态混入 delta event union，也 MUST NOT 要求 Core、Workflow 或其他调用方根据重叠字段自行判别最后一个 event。因终态与 delta 已由调用位置分离，流式终态使用与 `complete()` 相同的 `ModelFinalResult` shape，content-only 终态合法，不新增 public terminal discriminator 或 terminal marker schema。统一 model runtime MUST 在 hook 和调用方消费前校验 provider service 返回的终态与 delta；非法结果必须安全失败。

成功终态 MUST 保留归一化 content、存在时的 reasoning、完整 tool calls、provider-neutral finish reason、存在时的 provider-neutral incomplete output reason、存在时的安全 `providerResponseId`，以及 provider 可用时的 best-effort usage。系统 MUST 接受 `finishReason="stop"` 同时携带一个或多个完整 `toolCalls`，并依据非空 `toolCalls` 进入 Tool 分支；系统 MUST NOT 要求该字段只与 `finishReason="tool-calls"` 组合。cancellation、timeout、provider failure 或 normalization failure MUST 产生安全失败终态。

**需求类别**：功能性需求

#### Scenario: Stream 调用方不判别终态事件
- **WHEN** provider-neutral stream 依次产生 delta 并完成模型调用
- **THEN** `ModelInvocationService.stream()` MUST 通过 `onDelta` 交付全部增量
- **AND** MUST 通过返回的 Promise 单独交付唯一 `ModelFinalResult`
- **AND** 调用方 MUST NOT 缓存最后一个 delta 或编译 terminal schema 来识别终态

#### Scenario: 非流式调用完成
- **WHEN** native non-stream provider call 成功
- **THEN** 结果归一化为公共 `ModelFinalResult`
- **AND** 结果 MUST 通过包含 `incompleteOutputReason` 字段间约束的 closed terminal-result schema

#### Scenario: 流式调用完成
- **WHEN** stream 成功结束
- **THEN** `ModelInvocationService.stream()` 返回的 Promise 恰好交付一个成功 `ModelFinalResult`
- **AND** 其 `finishReason` 与 `incompleteOutputReason` 语义 MUST 与非流式成功结果一致

#### Scenario: Provider stream 没有结束事实
- **WHEN** provider stream 在交付零个或多个 delta 后结束，且没有产生 defined `finishReason` 或 provider failure
- **THEN** 模型调用边界 MUST 返回显式安全失败的 `ModelFinalResult`
- **AND** 系统 MUST NOT 把最后一个 delta 解释为成功终态

#### Scenario: Stop 终态同时返回 Tool call
- **WHEN** schema-valid 成功终态包含 `finishReason="stop"` 和一个或多个完整 `toolCalls`，且没有 `incompleteOutputReason`
- **THEN** 系统 MUST 保留这些 Tool calls
- **AND** Agent Core MUST 进入既有 Tool 执行与下一轮路径
- **AND** 系统 MUST NOT 仅因 finish reason 不是 `tool-calls` 而拒绝该结果

#### Scenario: Stream 被取消或失败
- **WHEN** cancellation、timeout、provider failure 或 normalization failure 终止 stream
- **THEN** `ModelInvocationService.stream()` 返回的 Promise 恰好交付一个安全失败 `ModelFinalResult`
- **AND** 该安全失败 MUST NOT 携带 `incompleteOutputReason`

### Requirement: Failure exits are explicit and safe

模型调用不能产生成功终态时，MUST 通过 `ModelFinalResult.safeError` 返回显式安全失败。模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前把 `finishReason="content-filter"` 映射为 `category="POLICY_DENIED"`、`retryable=false` 的安全失败，并移除该终态携带的 content、reasoning、Tool calls 和 `incompleteOutputReason`；它 MUST 把没有 `safeError` 的 `finishReason="error"` 映射为没有 recoverability 证据的 non-retryable 安全失败。没有 Tool call 的 `finishReason="unknown"`，以及没有完整 Tool call 的 `finishReason="tool-calls"`，在没有 `incompleteOutputReason` 时 MUST 同样安全失败。已有 `safeError` 的 error 终态 MUST 保留其可信 recoverability classification，并 MUST NOT 同时携带 `incompleteOutputReason`。模型边界 MUST NOT 暴露 raw provider result、error、endpoint、credential、header、custom fetch 或内部 lifecycle coordinates，也 MUST NOT 在内部切换模型。usage 缺失、不支持或单个 usage 字段非法不属于模型调用失败；但系统 MUST NOT 因 usage 缺失、部分非法或未达到有效输出预算而推断 `truncated-tool-call`。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Provider 调用失败
- **WHEN** provider execution 失败
- **THEN** 终态结果携带安全失败
- **AND** 模型边界不调用其他模型
- **AND** 终态 MUST NOT 携带 `incompleteOutputReason`

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

### Requirement: 输出超限不得静默截断

当模型终态携带 `incompleteOutputReason` 时，系统 SHALL 把该结果视为可恢复的不完整输出，不得直接提交 terminal success，也不得执行该结果携带或尚未完整形成的 Tool call。模型边界 MUST 对没有结构残缺 Tool call 的 `finishReason="length"` 输出设置 `incompleteOutputReason="output-limit"`。当 Tool call 结构残缺时，模型边界仅在以下任一条件成立时 MUST 设置 `incompleteOutputReason="truncated-tool-call"`：provider-neutral `finishReason="length"`；或者 `finishReason` 为 `tool-calls | stop | unknown`，且合法 `usage.outputTokens` 不小于本次有效 `maxOutputTokens`。后一个比较 MUST 使用整数 Token 值且不设置容差；不满足任何条件时 MUST 按 `Failure exits are explicit and safe` 返回安全失败。`content-filter`、`error` 和已有 `safeError` MUST 优先于上述推断且不得携带 `incompleteOutputReason`。

Agent core MUST 依据 `incompleteOutputReason` 而不是 `finishReason` 进入唯一输出恢复流程，并先尝试一次同请求预算提升。`incompleteOutputReason="output-limit"` 的预算提升结果仍为纯文本 `output-limit` 时，系统 MUST 在同一 request run 内最多发起 3 次 request-local 续写。`incompleteOutputReason="truncated-tool-call"` 只允许同请求预算提升重新生成一次；预算提升后仍有任一 `incompleteOutputReason` 时 MUST 安全失败，不得把残缺 Tool call 转成文本续写。只有恢复调用没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统才可提交最终回答或执行完整 Tool call。

同请求预算提升 MUST 复用同一模型路由、消息、工具集合、provider-neutral options、timeout 和 cancellation signal，只覆盖 `maxOutputTokens`。提升值 MUST 为原有效值的 8 倍且不超过 `32000 tokens`；同时 MUST 不超过基于当前模型 `contextWindowTokens` 与本次调用可得输入估算计算出的剩余输出窗口。原请求未显式设置 `maxOutputTokens` 时，候选提升值 MUST 为 `32000 tokens`。只有计算结果严格大于原有效值时才发起该次提升重试。

每次续写 MUST 把上一段 assistant 文本和一条隐藏的直接续写指令追加到本次恢复调用的 request-local 消息中，MUST 要求模型直接从截断处继续且不得道歉或复述；中间 assistant 文本和恢复指令 MUST NOT 作为独立 session message 持久化。续写段 MUST 按生成顺序拼接，恢复计数 MUST 以当前 model round 为边界且不得占用 Tool round 预算。

当第 3 次续写仍返回 `incompleteOutputReason="output-limit"`、预算提升后的结果携带 `truncated-tool-call`、续写阶段产生任一 `incompleteOutputReason` 或 Tool call，或恢复阶段产生其他无法安全接续的 Tool call 时，系统 MUST 发布不含原始输出的 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。direct model 可见文本硬上限 MUST 为 `150000` 个 UTF-16 code unit，并继续作为独立于输出 Token 恢复的容量保护。

当一次 direct model route 的累计 provider-neutral 可见文本首次超过 `150000` 个 UTF-16 code unit 时，系统 MUST 立即停止继续消费该模型输出，MUST 发布恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`，且 MUST NOT 启动该 route 的输出恢复、cross-model fallback 或执行模型返回的 Tool call。系统 MUST 从已接收的累计文本中保留顺序前缀且 MUST NOT 拆分 UTF-16 surrogate pair，必要时闭合末尾未闭合的 Markdown code fence 或 table row，追加固定标记 `[Model output truncated at the 150000-character safety limit.]`，并把总长不超过 `150000` 个 UTF-16 code unit 的结果作为唯一 terminal assistant message 提交；请求 MUST 以 `REQUEST_COMPLETED` 结束。超过容量的后缀和未完整形成的 Tool call MUST NOT 进入 stream 或 history，降级事件、SafeError、audit 和日志 MUST NOT 包含任何模型文本。

当 model delta、capability result 或 terminal assistant message 超过对应 persistence 或 stream 硬安全大小限制时，系统 MUST NOT 静默截断用户可见内容。除 read capability 明确返回 `truncated=true` 与 `nextOffset` 的逐行有界切片、上述输出不完整恢复流程，以及 direct model `150000` 个 UTF-16 code unit 上限的带固定标记有界交付外，Runtime、Agent core 或对应 boundary MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。任何超限与恢复处理 MUST NOT 把 raw prompt、provider-native raw output、Tool result、附件内容、credential、未脱敏路径或超过已声明容量的模型文本后缀写入 SafeError、stream、history、audit 或日志。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复、安全、性能/容量
**适用范围**：该 Function

#### Scenario: 明确 Token 超限提升预算后完成
- **GIVEN** 当前模型请求的有效 `maxOutputTokens` 为 `2048`
- **WHEN** provider 返回纯文本结果、`finishReason="length"` 和 `incompleteOutputReason="output-limit"`
- **THEN** Agent core MUST NOT 提交该截断结果
- **AND** MUST 使用相同请求输入把 `maxOutputTokens` 提升为 `16384` 后重试一次
- **AND** 当重试没有 `incompleteOutputReason` 且以 `finishReason="stop"` 完成时，系统 MUST 只提交重试得到的完整回答

#### Scenario: Tool calls 原因下的参数截断触发一次重生成
- **GIVEN** 本次有效 `maxOutputTokens` 为 `2048`
- **WHEN** provider 返回 `finishReason="tool-calls"`、结构残缺的 Tool call 和合法 `usage.outputTokens=2048`
- **THEN** 终态 MUST 保留 `finishReason="tool-calls"` 并设置 `incompleteOutputReason="truncated-tool-call"`
- **AND** Agent core MUST 使用提升后的预算重试相同请求一次
- **AND** MUST NOT 执行或向 hook 交付残缺 Tool call

#### Scenario: Stop 或 unknown 原因下的参数截断使用同一规则
- **GIVEN** provider 返回结构残缺的 Tool call，且合法 `usage.outputTokens` 不小于本次有效 `maxOutputTokens`
- **WHEN** provider-neutral `finishReason` 为 `stop` 或 `unknown`
- **THEN** 终态 MUST 保留对应 `finishReason` 并设置 `incompleteOutputReason="truncated-tool-call"`
- **AND** Agent core MUST 使用与 `tool-calls` 原因相同的一次同请求预算提升规则

#### Scenario: 参数残缺但预算未饱和不推断截断
- **GIVEN** 本次有效 `maxOutputTokens` 为 `2048`
- **WHEN** provider 返回非 `length` 结束原因、结构残缺的 Tool call 和合法 `usage.outputTokens=2047`
- **THEN** 模型边界 MUST 返回 `MODEL_TOOL_ARGUMENTS_INVALID` 安全失败
- **AND** 终态 MUST NOT 携带 `incompleteOutputReason`
- **AND** 输出恢复和 Tool 执行 MUST NOT 启动

#### Scenario: 参数残缺且 usage 缺失不推断截断
- **WHEN** provider 返回非 `length` 结束原因和结构残缺的 Tool call，但没有合法 `usage.outputTokens`
- **THEN** 模型边界 MUST 返回 `MODEL_TOOL_ARGUMENTS_INVALID` 安全失败
- **AND** 输出恢复和 Tool 执行 MUST NOT 启动

#### Scenario: 推断截断重生成后返回完整 Tool call
- **GIVEN** 首次结果携带 `incompleteOutputReason="truncated-tool-call"`
- **WHEN** 同请求预算提升返回没有 `incompleteOutputReason` 的一个或多个完整 Tool calls
- **THEN** 系统 MUST 只执行重生成得到的完整 Tool calls
- **AND** MUST NOT 持久化或执行首次残缺 Tool call

#### Scenario: 推断截断重生成后仍不完整则安全失败
- **GIVEN** 首次结果携带 `incompleteOutputReason="truncated-tool-call"`
- **WHEN** 同请求预算提升结果仍携带任一 `incompleteOutputReason`
- **THEN** 系统 MUST 发布 `DEGRADATION_NOTICE`，reason code 为 `MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL`
- **AND** MUST 以 safe `REQUEST_FAILED` 结束且不得发起文本续写
- **AND** 任一残缺 Tool call MUST NOT 执行

#### Scenario: 提升预算后最多续写三次
- **GIVEN** 同请求预算提升后的纯文本结果仍携带 `incompleteOutputReason="output-limit"`
- **WHEN** 后续恢复调用在第 1 次或第 2 次续写后仍返回 `output-limit`，并在不超过第 3 次续写时正常完成
- **THEN** 每次续写 MUST 看到此前已生成的 assistant 段和隐藏续写指令
- **AND** 用户可见最终回答 MUST 按顺序包含各段内容且不包含隐藏续写指令
- **AND** 中间恢复消息 MUST NOT 作为独立 session message 持久化

#### Scenario: 三次续写后仍超限则安全失败
- **WHEN** 提升预算后的结果与随后 3 次续写结果均携带 `incompleteOutputReason="output-limit"`
- **THEN** 系统 MUST 发布 `DEGRADATION_NOTICE`，reason code 为 `MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED`
- **AND** MUST 以 safe `REQUEST_FAILED` 结束
- **AND** MUST NOT 把任一截断段提交为 terminal assistant message

#### Scenario: Content filter 和 error 不进入恢复
- **WHEN** provider 返回 `finishReason="content-filter"`、`finishReason="error"` 或已有 `safeError`，且同时存在输出预算饱和或残缺 Tool call
- **THEN** 模型边界 MUST 按对应安全失败语义结束
- **AND** 终态 MUST NOT 携带 `incompleteOutputReason`
- **AND** Agent core MUST NOT 启动输出恢复或 Tool 执行

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

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：模型终态分别提供 provider-neutral 停止原因与可选输出不完整原因；输出不完整原因只表达明确或高可信的可恢复不完整输出，安全失败不携带该事实。
- **依据 Requirements**：`Non-streaming and streaming invocation share one terminal result contract`、`Failure exits are explicit and safe`、`输出超限不得静默截断`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统依据输出不完整原因统一进入有界恢复；明确 Token 超限允许预算提升和纯文本续写，推断 Tool call 截断只允许一次同请求预算提升，完整 Tool call 正常执行，没有截断证据的结构错误安全失败。
- **依据 Requirements**：`Failure exits are explicit and safe`、`输出超限不得静默截断`

### 结果

- **变更类型**：修改
- **目标内容**：恢复成功只交付重新生成的完整回答或完整 Tool call；恢复耗尽、残缺 Tool call 重生成失败、策略拦截和 provider error 均安全失败且不执行残缺 Tool call。
- **依据 Requirements**：`Failure exits are explicit and safe`、`输出超限不得静默截断`

### 规格

- **规格项**：输出不完整恢复
- **变更类型**：修改
- **原规格值**：仅 `finishReason="length"` 触发一次预算提升和最多 3 次纯文本续写
- **目标规格值**：`output-limit` 触发一次预算提升和最多 3 次纯文本续写；`truncated-tool-call` 只触发一次预算提升，仍不完整则安全失败；两类均不得执行残缺 Tool call
- **依据 Requirements**：`输出超限不得静默截断`
